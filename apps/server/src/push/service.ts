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
import {
    PUSH_NOTIFY_DEFAULT,
    chatWaitAsk,
    clipText,
    pushWaitText,
    terminalWaitAsk,
    type WaitAsk,
    type ChatItem,
    type EventMap,
    type AgentStatus,
    type ProcessAlert,
    type PushNotifyKind,
    type PushSubscribePayload,
    type PushAttentionEntry
} from '@ruimte/contracts';
import type { AuthStore } from '../auth/auth-store.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { unrefTimeout } from '@adecore/agents';
import { PushAttention } from './attention.ts';
import type { SnoozeChange } from './snoozes.ts';
import { encryptPush } from './encrypt.ts';
import { processAlertBody } from './process-alert.ts';

interface PushServiceOptions {
    auth: AuthStore;
    attentionPath?: string;
    identity: { id: string; sign(message: string): string };
    now?: () => number;
    machineName?: () => string;
    activityNodes?: () => { nodeId: string; target: PushAlertContent['target']; title: string; status: AgentStatus }[];
    titleFor?: (nodeId: string) => string | null;
    projectOf?: (nodeId: string) => string | null;
    /* Whether a person can open the node. A mark on any other, a hidden agent or a node since removed, would stay unread on a badge forever. */
    shows?: (nodeId: string) => boolean;
    targetOf?: (nodeId: string) => PushAlertContent['target'];
    send?: (push: PushEnvelope) => Promise<number>;
    onError?: (error: unknown) => void;
    snoozes?: Snoozes;
    schedule?: (delayMs: number, run: () => void) => () => void;
}

/* What the push side reads of `SnoozeStore`. */
interface Snoozes {
    isSnoozed(nodeId: string): boolean;
    noteStatus(nodeId: string, needsYou: boolean): void;
    observe(listener: (change: SnoozeChange) => void): () => void;
}

interface HeldAlert {
    content: PushAlertContent;
    issuedAt: number;
    preference: PushNotifyKind;
    ledger: boolean;
    dueAt: number;

    /* A wait's alert, whose body says what the node asks when it goes out rather than when it was raised. */
    wait?: boolean;
}

interface NodeState {
    target: PushAlertContent['target'];
    status: AgentStatus;
    title: string;
    startedAt: number;
    ask: WaitAsk | null;
}

const APPROVAL_MAX_AGE_MS = 110_000;
const TITLE_MAX = 160;
const NEEDS_YOU_BODY = 'The agent needs your attention.';
const BODY_MAX = 500;
/* How long a client's report of a person at it holds; the client renews it well within that. */
const PRESENCE_LEASE_MS = 60_000;
const HOLD_MS = 60_000;
// Short, since an approval card on the phone expires after `APPROVAL_MAX_AGE_MS`.
const APPROVAL_HOLD_MS = 10_000;

/* What a subscription hears of for a node: the list its project has, else its own, else what every device heard before it could choose. */
function notifyKinds(subscription: PushSubscribePayload, projectId: string | null): readonly PushNotifyKind[] {
    return (
        (projectId === null ? undefined : subscription.projects?.find((entry) => entry.projectId === projectId)?.notify) ??
        subscription.notify ??
        PUSH_NOTIFY_DEFAULT
    );
}

async function sendToAddressBook(push: PushEnvelope): Promise<number> {
    const response = await fetch(`${ADDRESS_BOOK_URL}/v1/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(push),
        signal: AbortSignal.timeout(10_000)
    });
    await response.body?.cancel();
    return response.status;
}

export class PushService {
    readonly attention: PushAttention;
    private readonly listeners = new Set<(entry: PushAttentionEntry) => void>();
    private readonly notificationListeners = new Set<(alert: EventMap['push.notification']) => void>();
    private alertQueue = Promise.resolve();
    private readonly options: PushServiceOptions;
    private readonly connectedSessions = new Map<string, number>();
    private readonly nodes = new Map<string, NodeState>();
    /* The approvals each chat still waits on, by request id, so the end of a snooze raises the card again. */
    private readonly approvals = new Map<string, Map<string, PushAlertContent>>();
    private readonly activityTimes = new Map<string, { phase: string; at: number }>();
    /* The process warnings already pushed, so a warning that stays raised pushes once. */
    private readonly processAlertIds = new Set<string>();
    private machineActivityQueue = Promise.resolve();
    private machineStartedAt = 0;
    private readonly machineActivityStates = new Map<string, string>();
    private readonly pending = new Set<Promise<void>>();
    /* The clients a person is at, by client id, with the end of each report's lease. */
    private readonly presentClients = new Map<string, number>();
    private held: HeldAlert[] = [];
    private cancelRelease: (() => void) | null = null;
    private readonly now: () => number;

    constructor(options: PushServiceOptions) {
        this.options = options;
        this.now = options.now ?? Date.now;
        this.attention = new PushAttention(options.attentionPath, this.now);
        options.snoozes?.observe((change) => this.snoozeChanged(change));
    }

    /* The ledger as clients mark nodes from it: only the nodes a person can open. */
    marks(): PushAttentionEntry[] {
        return this.attention.snapshot().filter((entry) => this.shows(entry.nodeId));
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
        const alert = { ...destination, nodeId, title: clipText(title, TITLE_MAX), body: clipText(body, BODY_MAX) };
        // Someone asked for this one, so it reaches the phone even while a person is at a desktop.
        this.enqueue(this.attentionContent(target, nodeId, alert.title, alert.body), true);
        for (const listener of this.notificationListeners) {
            listener(alert);
        }
    }

    read(nodeId: string, issuedAt: number): void {
        const entry = this.attention.read(nodeId, issuedAt);
        if (!entry) {
            return;
        }
        this.tell(entry);
        // Keep a read behind any alert already in flight to APNs.
        this.queueAlert(async () => {
            for (const { sessionId, subscription } of await this.options.auth.pushSubscriptions()) {
                if (!subscription.readSync || this.connectedSessions.has(sessionId)) {
                    continue;
                }
                const routing = { ...this.routing(subscription, nodeId, this.now() + PUSH_MAX_AGE_MS), issuedAt: Math.max(this.now(), entry.readThrough) };
                await this.sendCurrent(
                    sessionId,
                    subscription,
                    this.encrypt(routing, subscription, { nodeId, through: entry.readThrough, expiresAt: routing.expiresAt })
                );
            }
        });
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

    /*
     * A person at a desktop sees an alert there, so the phone gets it only once they leave or let it
     * stand: see `releaseHeld`. A client that stops reporting, or goes, ends its part.
     */
    reportPresence(clientId: string, present: boolean): void {
        if (present) {
            this.presentClients.set(clientId, this.now() + PRESENCE_LEASE_MS);
        } else if (!this.presentClients.delete(clientId)) {
            return;
        }
        this.releaseHeld();
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
            this.status('terminal', sessionId, agent.status, agent.suggestedTitle ?? 'Agent', terminalWaitAsk(agent.requests));
        } else if (event.event === 'chat.event') {
            const { chatId, event: chat } = event.payload;
            if (chat.type === 'info') {
                this.status('chat', chatId, chat.info.status, chat.info.suggestedTitle ?? 'Agent', chatWaitAsk(chat.info.requests));
            } else if (chat.type === 'item' && chat.item.kind === 'tool' && chat.item.state === 'running') {
                const node = this.nodes.get(chatId);
                if (node) {
                    this.track(this.deliverActivity(chatId, { title: clipText(node.title, TITLE_MAX), phase: 'tool', startedAt: node.startedAt }));
                }
            } else if (chat.type === 'item' && chat.item.kind === 'approval') {
                this.approval(chatId, chat.item);
            }
        }
    }

    async settled(): Promise<void> {
        while (this.pending.size) {
            await Promise.all([...this.pending]);
        }
    }

    private approval(chatId: string, item: Extract<ChatItem, { kind: 'approval' }>): void {
        const waiting = this.approvals.get(chatId) ?? new Map<string, PushAlertContent>();
        this.approvals.set(chatId, waiting);
        if (item.decision !== 'pending') {
            waiting.delete(item.requestId);
            return;
        }
        if (waiting.has(item.requestId)) {
            return;
        }
        const card: PushAlertContent = {
            kind: 'approval',
            target: 'chat',
            nodeId: chatId,
            title: this.nodes.get(chatId)?.title ?? 'Agent needs permission',
            body: clipText(item.description ?? item.toolName, BODY_MAX),
            requestId: item.requestId,
            choices: [
                { id: 'allow', kind: 'allow', label: 'Allow' },
                { id: 'deny', kind: 'deny', label: 'Deny' },
                ...(item.canAllowAlways ? [{ id: 'allow-always', kind: 'remember' as const, label: 'Always allow' }] : [])
            ],
            expiresAt: this.now() + APPROVAL_MAX_AGE_MS
        };
        waiting.set(item.requestId, card);
        if (!this.snoozed(chatId)) {
            this.enqueue(card);
        }
    }

    private status(target: PushAlertContent['target'], nodeId: string, status: AgentStatus, title: string, ask: WaitAsk | null): void {
        title = this.titleOf(nodeId, title);
        this.options.snoozes?.noteStatus(nodeId, status === 'needs-you');
        const previous = this.nodes.get(nodeId);
        const startedAt =
            status === 'running' && previous?.status !== 'running' && previous?.status !== 'needs-you' ? this.now() : (previous?.startedAt ?? this.now());
        this.nodes.set(nodeId, { target, status, title, startedAt, ask });
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
        if (status === 'needs-you' && !this.snoozed(nodeId)) {
            this.waitAlert(target, nodeId, title);
        }
        if (previous?.status === 'running' && (status === 'idle' || status === 'error') && !this.snoozed(nodeId)) {
            this.broadcast(
                {
                    kind: 'turn',
                    target,
                    nodeId,
                    title: clipText(title, TITLE_MAX),
                    body: status === 'idle' ? 'The agent finished its turn.' : 'The agent stopped with an error.',
                    expiresAt: this.now() + PUSH_MAX_AGE_MS
                },
                'turn'
            );
        }
        if (status === 'running' || status === 'needs-you' || status === 'idle' || status === 'error' || status === 'exited') {
            // A snoozed wait is as quiet on the node's own activity as in the machine counts.
            const phase = status === 'running' ? 'running' : status === 'needs-you' && !this.snoozed(nodeId) ? 'needs-you' : 'done';
            this.track(this.deliverActivity(nodeId, { title: clipText(title, TITLE_MAX), phase, startedAt }));
        }
    }

    private tell(entry: PushAttentionEntry): void {
        if (!this.shows(entry.nodeId)) {
            return;
        }
        for (const listener of this.listeners) {
            listener(entry);
        }
    }

    private shows(nodeId: string): boolean {
        return this.options.shows?.(nodeId) ?? true;
    }

    private titleOf(nodeId: string, fallback: string): string {
        return this.options.titleFor?.(nodeId) || fallback;
    }

    private snoozed(nodeId: string): boolean {
        return this.options.snoozes?.isSnoozed(nodeId) ?? false;
    }

    private activityNodes(): { nodeId: string; target: PushAlertContent['target']; title: string; status: AgentStatus }[] {
        return this.options.activityNodes?.() ?? [...this.nodes].map(([nodeId, node]) => ({ nodeId, ...node }));
    }

    /*
     * A snoozed node takes back the alert it already raised, as the desktop closes its notification, and
     * its activity goes quiet. A snooze that runs out on a node still waiting is a new wait and raises the
     * alert again, the approval cards it waits on if it has any; one a person ended raises nothing.
     */
    private snoozeChanged({ kind, nodeId }: SnoozeChange): void {
        const node = this.activityNodes().find((entry) => entry.nodeId === nodeId);
        if (kind === 'snoozed' && node) {
            this.options.snoozes?.noteStatus(nodeId, node.status === 'needs-you');
        }
        if (kind === 'snoozed') {
            const entry = this.attention.snapshot().find((candidate) => candidate.nodeId === nodeId);
            if (entry && entry.readThrough < entry.issuedAt) {
                this.read(nodeId, entry.issuedAt);
            }
        }
        if (kind === 'woke' && node?.status === 'needs-you') {
            const cards = [...(this.approvals.get(nodeId)?.values() ?? [])];
            for (const card of cards) {
                this.enqueue({ ...card, expiresAt: this.now() + APPROVAL_MAX_AGE_MS });
            }
            if (cards.length === 0) {
                this.waitAlert(node.target, nodeId, this.titleOf(nodeId, node.title));
            }
        }
        if (node?.status === 'needs-you') {
            const title = clipText(this.titleOf(nodeId, node.title), TITLE_MAX);
            const phase = kind === 'snoozed' ? 'done' : 'needs-you';
            this.track(this.deliverActivity(nodeId, { title, phase, startedAt: this.nodes.get(nodeId)?.startedAt ?? this.now() }));
        }
        this.synchronizeActivities();
    }

    /* Something a person has to step in on that no status says: a task that failed, a wake the daemon gave up on. */
    alert(target: PushAlertContent['target'], nodeId: string, title: string, body: string): void {
        this.enqueue(this.attentionContent(target, nodeId, title, body));
    }

    private waitAlert(target: PushAlertContent['target'], nodeId: string, title: string): void {
        this.enqueue(this.attentionContent(target, nodeId, title, this.waitBody(nodeId)), false, true);
    }

    private waitBody(nodeId: string): string {
        const ask = this.nodes.get(nodeId)?.ask;

        return ask ? pushWaitText(ask) : NEEDS_YOU_BODY;
    }

    private attentionContent(target: PushAlertContent['target'], nodeId: string, title: string, body: string): PushAlertContent {
        return {
            kind: 'attention',
            target,
            nodeId,
            title: clipText(title, TITLE_MAX),
            body: clipText(body, BODY_MAX),
            expiresAt: this.now() + PUSH_MAX_AGE_MS
        };
    }

    /* Pushes each warning about a node once while it stays raised; one that clears and comes back is new. */
    processAlerts(alerts: readonly ProcessAlert[]): void {
        const raised = new Set(alerts.map((alert) => alert.id));
        for (const id of this.processAlertIds) {
            if (!raised.has(id)) {
                this.processAlertIds.delete(id);
            }
        }
        for (const alert of alerts) {
            if (this.processAlertIds.has(alert.id)) {
                continue;
            }
            this.processAlertIds.add(alert.id);
            // A phone opens the node a push names, so a warning about no node has nowhere to go.
            if (alert.nodeId === null || this.snoozed(alert.nodeId)) {
                continue;
            }
            const nodeId = alert.nodeId;
            this.broadcast(
                {
                    kind: 'attention',
                    target: this.nodes.get(nodeId)?.target ?? this.options.targetOf?.(nodeId) ?? 'terminal',
                    nodeId,
                    title: clipText(this.titleOf(nodeId, this.nodes.get(nodeId)?.title || 'Agent'), TITLE_MAX),
                    body: processAlertBody(alert),
                    expiresAt: this.now() + PUSH_MAX_AGE_MS
                },
                'process'
            );
        }
    }

    synchronizeActivities(): void {
        // A snoozed wait counts as nothing at all until the snooze ends.
        const nodes = this.activityNodes().filter((node) => node.status !== 'needs-you' || !this.snoozed(node.nodeId));
        const states = nodes.map((node) => node.status);
        const agents: NonNullable<PushActivityContent['agents']> = nodes
            .filter((node) => node.status === 'running' || node.status === 'needs-you')
            .sort((left, right) => Number(right.status === 'needs-you') - Number(left.status === 'needs-you') || left.nodeId.localeCompare(right.nodeId))
            .slice(0, 2)
            .map((node) => ({
                nodeId: node.nodeId,
                target: node.target,
                title: clipText(this.titleOf(node.nodeId, node.title), 80),
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
            title: clipText(this.options.machineName?.() ?? 'Ruimte', TITLE_MAX),
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
            const push = this.signedActivity(this.routing(subscription, MACHINE_ACTIVITY_NODE, this.now() + PUSH_MAX_AGE_MS), activity);
            if (await this.sendCurrent(sessionId, subscription, push)) {
                this.machineActivityStates.set(sessionId, cacheKey);
            }
        }
    }

    private enqueue(content: PushAlertContent, immediate = false, wait = false): void {
        const entry = this.attention.notify(content.nodeId);
        this.tell(entry);
        if (immediate) {
            this.queueAlert(() => this.deliverAlert(content, entry.issuedAt, 'needs-you', true));
        } else {
            this.dispatch({ content, issuedAt: entry.issuedAt, preference: 'needs-you', ledger: true, ...(wait ? { wait } : {}) });
        }
    }

    /*
     * A push outside the attention ledger: the ledger marks a node unread on every client, and a finished
     * turn or a process warning only reaches the devices that asked for it.
     */
    private broadcast(content: PushAlertContent, preference: PushNotifyKind): void {
        this.dispatch({ content, issuedAt: this.now(), preference, ledger: false });
    }

    private dispatch(alert: Omit<HeldAlert, 'dueAt'>): void {
        if (!this.present()) {
            this.queueAlert(() => this.deliverAlert(alert.content, alert.issuedAt, alert.preference, alert.ledger));
            return;
        }
        const dueAt = this.now() + (alert.content.kind === 'approval' ? APPROVAL_HOLD_MS : HOLD_MS);
        this.held.push({ ...alert, dueAt });
        this.releaseHeld();
    }

    private present(): boolean {
        const now = this.now();
        for (const [clientId, until] of this.presentClients) {
            if (until <= now) {
                this.presentClients.delete(clientId);
            }
        }
        return this.presentClients.size > 0;
    }

    /*
     * Sends every held alert once the person left, and the ones that came due while they stay. Due at
     * the desk, a wait still unread or an approval still open goes out; a finished turn or a process
     * warning the desktop already showed goes nowhere.
     */
    private releaseHeld(): void {
        this.cancelRelease?.();
        this.cancelRelease = null;
        const present = this.present();
        const now = this.now();
        const due = present ? this.held.filter((alert) => alert.dueAt <= now) : this.held;
        this.held = present ? this.held.filter((alert) => alert.dueAt > now) : [];
        for (const alert of due) {
            const content = alert.wait ? { ...alert.content, body: clipText(this.waitBody(alert.content.nodeId), BODY_MAX) } : alert.content;
            if (
                (present && !alert.ledger) ||
                this.snoozed(content.nodeId) ||
                (content.kind === 'approval' && !this.approvals.get(content.nodeId)?.has(content.requestId ?? ''))
            ) {
                continue;
            }
            this.queueAlert(() => this.deliverAlert(content, alert.issuedAt, alert.preference, alert.ledger));
        }
        if (this.held.length === 0) {
            return;
        }
        const next = Math.min(...this.held.map((alert) => alert.dueAt), ...this.presentClients.values());
        this.cancelRelease = (this.options.schedule ?? unrefTimeout)(Math.max(0, next - now), () => {
            this.cancelRelease = null;
            this.releaseHeld();
        });
    }

    private queueAlert(work: () => Promise<void>): void {
        this.alertQueue = this.alertQueue.then(work).catch((error: unknown) => this.options.onError?.(error));
        this.track(this.alertQueue);
    }

    private track(work: Promise<void>): void {
        const caught = work.catch((error: unknown) => this.options.onError?.(error));
        this.pending.add(caught);
        void caught.then(() => this.pending.delete(caught));
    }

    private routing(subscription: PushSubscribePayload, nodeId: string, expiresAt: number, lane?: PushNotifyKind): PushRouting {
        const issuedAt = this.now();
        return {
            machineId: this.options.identity.id,
            handle: subscription.handle,
            id: randomBytes(32).toString('base64url'),
            issuedAt,
            expiresAt: Math.min(expiresAt, issuedAt + PUSH_MAX_AGE_MS),
            collapseId: createHash('sha256')
                .update(pushCollapseIdMessage(this.options.identity.id, nodeId, lane))
                .digest('base64url')
        };
    }

    private async deliverAlert(content: PushAlertContent, issuedAt: number, preference: PushNotifyKind, ledger: boolean): Promise<void> {
        const projectId = this.options.projectOf?.(content.nodeId) ?? null;
        for (const { sessionId, subscription } of await this.options.auth.pushSubscriptions()) {
            if (
                (ledger && this.attention.isRead(content.nodeId, issuedAt)) ||
                this.connectedSessions.has(sessionId) ||
                (content.kind === 'approval' ? !subscription.approvals : !subscription.followAll && !subscription.follow.includes(content.nodeId)) ||
                !notifyKinds(subscription, projectId).includes(preference)
            ) {
                continue;
            }
            // A finished turn or a process warning must never replace a wait or an approval still open on the phone.
            const lane = preference === 'needs-you' ? undefined : preference;
            const routing = { ...this.routing(subscription, content.nodeId, content.expiresAt, lane), issuedAt };
            if (routing.expiresAt <= this.now()) {
                continue;
            }
            await this.sendCurrent(sessionId, subscription, this.encrypt(routing, subscription, { ...content, expiresAt: routing.expiresAt }));
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
            const push = this.signedActivity(this.routing(subscription, nodeId, this.now() + PUSH_MAX_AGE_MS), activity);
            if (await this.sendCurrent(sessionId, subscription, push)) {
                this.activityTimes.set(cacheKey, { phase: activity.phase, at: this.now() });
            }
        }
    }

    private encrypt(routing: PushRouting, subscription: PushSubscribePayload, content: Parameters<typeof encryptPush>[2]): PushEnvelope {
        return encryptPush(routing, subscription.publicKey, content, (message) => this.options.identity.sign(message));
    }

    private signedActivity(routing: PushRouting, activity: PushActivityContent): PushEnvelope {
        const push: PushEnvelope = { ...routing, pushType: 'liveactivity', activity, signature: '' };
        push.signature = this.options.identity.sign(pushMessage(push));
        return push;
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
