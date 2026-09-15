import { createHash, randomBytes } from 'node:crypto';
import {
    ADDRESS_BOOK_URL,
    PUSH_MAX_AGE_MS,
    pushMessage,
    pushCollapseIdMessage,
    type PushActivityContent,
    type PushAlertContent,
    type PushEnvelope,
    type PushRouting
} from '@ruimte/pulsar';
import type { AgentStatus, PushSubscribePayload } from '@ruimte/contracts';
import type { AuthStore } from '../auth/auth-store.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { encryptPush } from './encrypt.ts';

interface PushServiceOptions {
    auth: AuthStore;
    identity: { id: string; sign(message: string): string };
    now?: () => number;
    titleFor?: (nodeId: string) => string | null;
    send?: (push: PushEnvelope) => Promise<number>;
    onError?: (error: unknown) => void;
}

interface NodeState {
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
    private readonly options: PushServiceOptions;
    private readonly connectedSessions = new Map<string, number>();
    private readonly nodes = new Map<string, NodeState>();
    private readonly approvals = new Map<string, Set<string>>();
    private readonly activityTimes = new Map<string, { phase: string; at: number }>();
    private readonly pending = new Set<Promise<void>>();
    private readonly now: () => number;

    constructor(options: PushServiceOptions) {
        this.options = options;
        this.now = options.now ?? Date.now;
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

    async hasOfflineApprovals(): Promise<boolean> {
        return (await this.options.auth.pushSubscriptions()).some(
            ({ sessionId, subscription }) => subscription.approvals && !this.connectedSessions.has(sessionId)
        );
    }

    consume(event: SessionEvent): void {
        if (event.event === 'session.status' && event.payload.agent) {
            const { sessionId, agent } = event.payload;
            this.status('terminal', sessionId, agent.status, agent.suggestedTitle ?? 'Agent');
        } else if (event.event === 'session.approvals') {
            const { sessionId, approvals } = event.payload;
            const previous = this.approvals.get(sessionId) ?? new Set();
            this.approvals.set(sessionId, new Set(approvals.map((approval) => approval.requestId)));
            for (const approval of approvals) {
                if (!previous.has(approval.requestId)) {
                    this.enqueue({
                        kind: 'approval',
                        target: 'terminal',
                        nodeId: sessionId,
                        title: this.nodes.get(sessionId)?.title ?? 'Agent needs permission',
                        body: approval.summary.slice(0, 500),
                        requestId: approval.requestId,
                        choices: approval.choices.slice(0, 8).map((choice) => ({ ...choice, label: choice.label.slice(0, 80) })),
                        expiresAt: approval.expiresAt
                    });
                }
            }
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
        this.nodes.set(nodeId, { status, title, startedAt });
        if (status === previous?.status) {
            return;
        }
        if (status === 'needs-you' || (status === 'idle' && previous && previous.status !== 'idle')) {
            this.enqueue({
                kind: status === 'idle' ? 'turn' : 'attention',
                target,
                nodeId,
                title: title.slice(0, 160),
                body: status === 'idle' ? 'The agent finished its turn.' : 'The agent needs your attention.',
                expiresAt: this.now() + PUSH_MAX_AGE_MS
            });
        }
        if (status === 'running' || status === 'needs-you' || status === 'idle' || status === 'error' || status === 'exited') {
            const phase = status === 'running' ? 'running' : status === 'needs-you' ? 'needs-you' : 'done';
            this.track(this.deliverActivity(nodeId, { title: title.slice(0, 160), phase, startedAt }));
        }
    }

    private enqueue(content: PushAlertContent): void {
        this.track(this.deliverAlert(content));
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

    private async deliverAlert(content: PushAlertContent): Promise<void> {
        for (const { sessionId, subscription } of await this.options.auth.pushSubscriptions()) {
            if (
                this.connectedSessions.has(sessionId) ||
                (content.kind === 'approval' ? !subscription.approvals : !subscription.follow.includes(content.nodeId))
            ) {
                continue;
            }
            const routing = this.routing(subscription, content.nodeId, content.expiresAt);
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
            if (!subscription.activities || !subscription.follow.includes(nodeId)) {
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
