import { createHash, randomBytes } from 'node:crypto';
import {
    ADDRESS_BOOK_URL,
    MACHINE_ACTIVITY_NODE,
    PUSH_MAX_AGE_MS,
    pushMessage,
    pushCollapseIdMessage,
    type PushActivityContent,
    type PushAlertContent,
    type PushEnvelope,
    type PushRouting
} from '@ruimte/pulsar';
import type { EventMap, AgentStatus, PushSubscribePayload, PushAttentionEntry } from '@ruimte/contracts';
import type { AuthStore } from '../auth/auth-store.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { PushAttention } from './attention.ts';
import { encryptPush } from './encrypt.ts';

interface PushServiceOptions {
    auth: AuthStore;
    attentionPath?: string;
    identity: { id: string; sign(message: string): string };
    now?: () => number;
    machineName?: () => string;
    activityNodes?: () => { nodeId: string; target: PushAlertContent['target']; title: string; status: AgentStatus }[];
    titleFor?: (nodeId: string) => string | null;
    send?: (push: PushEnvelope) => Promise<number>;
    onError?: (error: unknown) => void;
}

interface NodeState {
    target: PushAlertContent['target'];
    status: AgentStatus;
    title: string;
    startedAt: number;
}

const sendToAddressBook = async (push: PushEnvelope): Promise<number> => {
    const response = await fetch(`${ADDRESS_BOOK_URL}/v1/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(push),
        signal: AbortSignal.timeout(10_000)
    });
    await response.body?.cancel();
    return response.status;
};

export class PushService {
    readonly attention: PushAttention;
    private readonly listeners = new Set<(entry: PushAttentionEntry) => void>();
    private readonly notificationListeners = new Set<(alert: EventMap['push.notification']) => void>();
    private alertQueue = Promise.resolve();
    private readonly options: PushServiceOptions;
    private readonly connectedSessions = new Map<string, number>();
    private readonly nodes = new Map<string, NodeState>();
    private readonly approvals = new Map<string, Set<string>>();
    private readonly activityTimes = new Map<string, { phase: string; at: number }>();
    private machineActivityQueue = Promise.resolve();
    private machineStartedAt = 0;
    private readonly machineActivityStates = new Map<string, string>();
    private readonly pending = new Set<Promise<void>>();
    private readonly now: () => number;

    constructor(options: PushServiceOptions) {
        this.options = options;
        this.now = options.now ?? Date.now;
        this.attention = new PushAttention(options.attentionPath, this.now);
    }

    observeAttention(listener: (entry: PushAttentionEntry) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    observeNotification(listener: (alert: EventMap['push.notification']) => void): () => void {
        this.notificationListeners.add(listener);
        return () => {
            this.notificationListeners.delete(listener);
        };
    }

    notify(
        target: PushAlertContent['target'],
        nodeId: string,
        title: string,
        body: string,
        destination: Pick<EventMap['push.notification'], 'projectId' | 'viewId'>
    ): void {
        const alert = { ...destination, nodeId, title: title.slice(0, 160), body: body.slice(0, 500) };
        this.alert(target, nodeId, alert.title, alert.body);
        for (const listener of this.notificationListeners) {
            listener(alert);
        }
    }

    read(nodeId: string, issuedAt: number): void {
        const entry = this.attention.read(nodeId, issuedAt);
        if (!entry) {
            return;
        }
        for (const listener of this.listeners) {
            listener(entry);
        }
        // Keep a read behind any alert already in flight to APNs.
        this.alertQueue = this.alertQueue
            .then(async () => {
                for (const { sessionId, subscription } of await this.options.auth.pushSubscriptions()) {
                    if (!subscription.readSync || this.connectedSessions.has(sessionId)) {
                        continue;
                    }
                    const routing = { ...this.routing(subscription, nodeId, this.now() + PUSH_MAX_AGE_MS), issuedAt: Math.max(this.now(), entry.readThrough) };
                    const push = encryptPush(routing, subscription.publicKey, { nodeId, through: entry.readThrough, expiresAt: routing.expiresAt }, (message) =>
                        this.options.identity.sign(message)
                    );
                    await this.sendCurrent(sessionId, subscription, push);
                }
            })
            .catch((error: unknown) => this.options.onError?.(error));
        this.track(this.alertQueue);
    }

    connected(sessionId: string | null): () => void {
        if (sessionId === null) {
            return () => undefined;
        }
        this.connectedSessions.set(sessionId, (this.connectedSessions.get(sessionId) ?? 0) + 1);
        return () => {
            const count = (this.connectedSessions.get(sessionId) ?? 1) - 1;
            if (count === 0) {
                this.connectedSessions.delete(sessionId);
            } else {
                this.connectedSessions.set(sessionId, count);
            }
        };
    }

    consume(event: SessionEvent): void {
        if (event.event === 'session.exit') {
            this.nodes.delete(event.payload.sessionId);
            this.synchronizeActivities();
        }
        if (event.event === 'session.list-changed') {
            this.synchronizeActivities();
        }
        if (event.event === 'session.status' && event.payload.agent) {
            const { sessionId, agent } = event.payload;
            this.status('terminal', sessionId, agent.status, agent.suggestedTitle ?? 'Agent');
        } else if (event.event === 'chat.event') {
            const { chatId, event: chat } = event.payload;
            if (chat.type === 'info') {
                this.status('chat', chatId, chat.info.status, chat.info.suggestedTitle ?? 'Agent');
            } else if (chat.type === 'item' && chat.item.kind === 'tool' && chat.item.state === 'running') {
                const node = this.nodes.get(chatId);
                if (node) {
                    this.track(this.deliverActivity(chatId, { title: node.title.slice(0, 160), phase: 'tool', startedAt: node.startedAt }));
                }
            } else if (chat.type === 'item' && chat.item.kind === 'approval') {
                const item = chat.item;
                const seen = this.approvals.get(chatId) ?? new Set<string>();
                this.approvals.set(chatId, seen);
                if (item.decision !== 'pending') {
                    seen.delete(item.requestId);
                    return;
                }
                if (seen.has(item.requestId)) {
                    return;
                }
                seen.add(item.requestId);
                this.enqueue({
                    kind: 'approval',
                    target: 'chat',
                    nodeId: chatId,
                    title: this.nodes.get(chatId)?.title ?? 'Agent needs permission',
                    body: (item.description ?? item.toolName).slice(0, 500),
                    requestId: item.requestId,
                    choices: [
                        { id: 'allow', kind: 'allow', label: 'Allow' },
                        { id: 'deny', kind: 'deny', label: 'Deny' },
                        ...(item.canAllowAlways ? [{ id: 'allow-always', kind: 'remember' as const, label: 'Always allow' }] : [])
                    ],
                    expiresAt: this.now() + 110_000
                });
            }
        }
    }

    async settled(): Promise<void> {
        while (this.pending.size) {
            await Promise.all([...this.pending]);
        }
    }

    private status(target: PushAlertContent['target'], nodeId: string, status: AgentStatus, title: string): void {
        title = this.options.titleFor?.(nodeId) || title;
        const previous = this.nodes.get(nodeId);
        const startedAt =
            status === 'running' && previous?.status !== 'running' && previous?.status !== 'needs-you' ? this.now() : (previous?.startedAt ?? this.now());
        this.nodes.set(nodeId, { target, status, title, startedAt });
        this.synchronizeActivities();
        if (status === previous?.status) {
            return;
        }
        if (status === 'running' || status === 'exited') {
            const entry = this.attention.snapshot().find((entry) => entry.nodeId === nodeId);
            if (entry) {
                this.read(nodeId, entry.issuedAt);
            }
        }
        if (status === 'needs-you') {
            this.enqueue({
                kind: 'attention',
                target,
                nodeId,
                title: title.slice(0, 160),
                body: 'The agent needs your attention.',
                expiresAt: this.now() + PUSH_MAX_AGE_MS
            });
        }
        if (status === 'running' || status === 'needs-you' || status === 'idle' || status === 'error' || status === 'exited') {
            const phase = status === 'running' ? 'running' : status === 'needs-you' ? 'needs-you' : 'done';
            this.track(this.deliverActivity(nodeId, { title: title.slice(0, 160), phase, startedAt }));
        }
    }

    /* Something a person has to step in on that no status says: a task that failed, a wake the daemon gave up on. */
    alert(target: PushAlertContent['target'], nodeId: string, title: string, body: string): void {
        this.enqueue({
            kind: 'attention',
            target,
            nodeId,
            title: title.slice(0, 160),
            body: body.slice(0, 500),
            expiresAt: this.now() + PUSH_MAX_AGE_MS
        });
    }

    synchronizeActivities(): void {
        const nodes = this.options.activityNodes?.() ?? [...this.nodes].map(([nodeId, node]) => ({ nodeId, ...node }));
        const states = nodes.map((node) => node.status);
        const agents: NonNullable<PushActivityContent['agents']> = nodes
            .filter((node) => node.status === 'running' || node.status === 'needs-you')
            .sort((left, right) => Number(right.status === 'needs-you') - Number(left.status === 'needs-you') || left.nodeId.localeCompare(right.nodeId))
            .slice(0, 2)
            .map((node) => ({
                nodeId: node.nodeId,
                target: node.target,
                title: (this.options.titleFor?.(node.nodeId) || node.title).slice(0, 80),
                phase: node.status === 'needs-you' ? 'needs-you' : 'running',
                startedAt: this.nodes.get(node.nodeId)?.startedAt
            }));
        const runningCount = states.filter((state) => state === 'running').length;
        const attentionCount = states.filter((state) => state === 'needs-you').length;
        const active = runningCount + attentionCount > 0;
        if (active && !this.machineStartedAt) {
            this.machineStartedAt = this.now();
        }
        const activity: PushActivityContent = {
            title: (this.options.machineName?.() ?? 'Ruimte').slice(0, 160),
            phase: attentionCount ? 'needs-you' : runningCount ? 'running' : 'done',
            startedAt: this.machineStartedAt || this.now(),
            runningCount,
            attentionCount,
            agents
        };
        if (!active) {
            this.machineStartedAt = 0;
        }
        // Preserve start/update/end order when several agents change state in the same turn.
        this.machineActivityQueue = this.machineActivityQueue
            .then(() => this.deliverMachineActivity(activity))
            .catch((error: unknown) => this.options.onError?.(error));
        this.track(this.machineActivityQueue);
    }

    private async deliverMachineActivity(activity: PushActivityContent): Promise<void> {
        const state = JSON.stringify(activity.phase === 'done' ? { ...activity, startedAt: 0 } : activity);
        for (const { sessionId, subscription } of await this.options.auth.pushSubscriptions()) {
            if (!subscription.activities || subscription.activityScope !== 'machine') {
                this.machineActivityStates.delete(sessionId);
                continue;
            }
            const cacheKey = JSON.stringify([subscription.handle, state]);
            if (this.machineActivityStates.get(sessionId) === cacheKey) {
                continue;
            }
            const routing = this.routing(subscription, MACHINE_ACTIVITY_NODE, this.now() + PUSH_MAX_AGE_MS);
            const push: PushEnvelope = { ...routing, pushType: 'liveactivity', activity, signature: '' };
            push.signature = this.options.identity.sign(pushMessage(push));
            if (await this.sendCurrent(sessionId, subscription, push)) {
                this.machineActivityStates.set(sessionId, cacheKey);
            }
        }
    }

    private enqueue(content: PushAlertContent): void {
        const entry = this.attention.notify(content.nodeId);
        for (const listener of this.listeners) {
            listener(entry);
        }
        this.alertQueue = this.alertQueue.then(() => this.deliverAlert(content, entry.issuedAt)).catch((error: unknown) => this.options.onError?.(error));
        this.track(this.alertQueue);
    }

    private track(work: Promise<void>): void {
        const caught = work.catch((error: unknown) => this.options.onError?.(error));
        this.pending.add(caught);
        void caught.then(() => this.pending.delete(caught));
    }

    private routing(subscription: PushSubscribePayload, nodeId: string, expiresAt: number): PushRouting {
        const issuedAt = this.now();
        return {
            machineId: this.options.identity.id,
            handle: subscription.handle,
            id: randomBytes(32).toString('base64url'),
            issuedAt,
            expiresAt: Math.min(expiresAt, issuedAt + PUSH_MAX_AGE_MS),
            collapseId: createHash('sha256').update(pushCollapseIdMessage(this.options.identity.id, nodeId)).digest('base64url')
        };
    }

    private async deliverAlert(content: PushAlertContent, issuedAt: number): Promise<void> {
        for (const { sessionId, subscription } of await this.options.auth.pushSubscriptions()) {
            if (
                this.attention.isRead(content.nodeId, issuedAt) ||
                this.connectedSessions.has(sessionId) ||
                (content.kind === 'approval' ? !subscription.approvals : !subscription.followAll && !subscription.follow.includes(content.nodeId))
            ) {
                continue;
            }
            const routing = { ...this.routing(subscription, content.nodeId, content.expiresAt), issuedAt };
            if (routing.expiresAt <= this.now()) {
                continue;
            }
            const push = encryptPush(routing, subscription.publicKey, { ...content, expiresAt: routing.expiresAt }, (message) =>
                this.options.identity.sign(message)
            );
            await this.sendCurrent(sessionId, subscription, push);
        }
    }

    private async deliverActivity(nodeId: string, activity: PushActivityContent): Promise<void> {
        for (const { sessionId, subscription } of await this.options.auth.pushSubscriptions()) {
            if (
                subscription.activityScope === 'machine' ||
                !subscription.activities ||
                !subscription.follow.includes(nodeId) ||
                (subscription.activityNodeId !== undefined && subscription.activityNodeId !== nodeId)
            ) {
                continue;
            }
            const cacheKey = `${sessionId}:${nodeId}`;
            const last = this.activityTimes.get(cacheKey);
            if (last?.phase === activity.phase || (last && this.now() - last.at < 5_000 && activity.phase === 'running')) {
                continue;
            }
            const routing = this.routing(subscription, nodeId, this.now() + PUSH_MAX_AGE_MS);
            const push: PushEnvelope = { ...routing, pushType: 'liveactivity', activity, signature: '' };
            push.signature = this.options.identity.sign(pushMessage(push));
            if (await this.sendCurrent(sessionId, subscription, push)) {
                this.activityTimes.set(cacheKey, { phase: activity.phase, at: this.now() });
            }
        }
    }

    private async sendCurrent(sessionId: string, subscription: PushSubscribePayload, push: PushEnvelope): Promise<boolean> {
        const current = (await this.options.auth.pushSubscriptions()).find((entry) => entry.sessionId === sessionId);
        // A revoke, changed destination, or resumed foreground connection wins over queued delivery.
        if (
            !current ||
            JSON.stringify(current.subscription) !== JSON.stringify(subscription) ||
            (push.pushType === 'alert' && this.connectedSessions.has(sessionId))
        ) {
            return false;
        }
        const status = await (this.options.send ?? sendToAddressBook)(push);
        if (status === 401 || status === 410) {
            await this.options.auth.removePush(sessionId, subscription.handle);
        }
        return status >= 200 && status < 300;
    }
}
