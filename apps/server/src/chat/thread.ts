import { randomUUID } from 'node:crypto';
import { ChatError } from './errors.ts';
import type { AgentStatus, ChatApprovalItem, ChatEvent, ChatHistoryResult, ChatInfo, ChatItem, ChatQuestionItem } from '@ruimte/contracts';

/*
 * The state of one chat as the client sees it. Every mutation answers the event that describes
 * it, so the daemon broadcasts exactly what it applied and a reload can rebuild from `snapshot`.
 */
export class ChatThread {
    info: ChatInfo;
    private readonly items = new Map<string, ChatItem>();
    private readonly order: string[] = [];
    private historyGeneration = randomUUID();
    private readonly indices = new Map<string, number>();

    constructor(info: ChatInfo, items: ChatItem[] = []) {
        this.info = info;
        for (const item of items) {
            this.items.set(item.id, item);
            this.indices.set(item.id, this.order.length);
            this.order.push(item.id);
        }
    }

    get(id: string): ChatItem | undefined {
        return this.items.get(id);
    }

    list(): ChatItem[] {
        return this.order.map((id) => this.items.get(id)!);
    }

    find<K extends ChatItem['kind']>(kind: K, match: (item: Extract<ChatItem, { kind: K }>) => boolean): Extract<ChatItem, { kind: K }> | undefined {
        for (let i = this.order.length - 1; i >= 0; i--) {
            const item = this.items.get(this.order[i]!);
            if (item?.kind === kind && match(item as Extract<ChatItem, { kind: K }>)) {
                return item as Extract<ChatItem, { kind: K }>;
            }
        }
        return undefined;
    }

    upsert(item: ChatItem): ChatEvent {
        if (!this.items.has(item.id)) {
            this.indices.set(item.id, this.order.length);
            this.order.push(item.id);
        }
        this.items.set(item.id, item);
        return { type: 'item', item, historyIndex: this.indices.get(item.id)! };
    }

    /* Streams text into an assistant or thinking item, or partial output into a tool call that is still running. */
    appendText(itemId: string, text: string): ChatEvent | null {
        const item = this.items.get(itemId);
        if (item?.kind === 'assistant' || item?.kind === 'thinking') {
            this.items.set(itemId, { ...item, text: item.text + text });
            return { type: 'delta', itemId, text };
        }
        if (item?.kind === 'tool' && item.state === 'running') {
            const progress = item.progress ?? { startedAt: null, description: null, output: null };
            this.items.set(itemId, { ...item, progress: { ...progress, output: (progress.output ?? '') + text } });
            return { type: 'delta', itemId, text };
        }
        return null;
    }

    patchInfo(patch: Partial<ChatInfo>): ChatEvent {
        this.info = { ...this.info, ...patch };
        return { type: 'info', info: this.info };
    }

    /* Empties the thread; the info carries on with the patch on top. */
    reset(patch: Partial<ChatInfo>): ChatEvent {
        this.items.clear();
        this.indices.clear();
        this.historyGeneration = randomUUID();
        this.order.length = 0;
        this.info = { ...this.info, ...patch };
        return { type: 'reset', info: this.info, items: [] };
    }

    /* Applies an event this thread answered before, as a log read back after a restart hands it in. */
    apply(event: ChatEvent): void {
        switch (event.type) {
            case 'item':
                this.upsert(event.item);
                break;
            case 'delta':
                this.appendText(event.itemId, event.text);
                break;
            case 'info':
                this.info = event.info;
                break;
            case 'reset':
                this.reset(event.info);
                for (const item of event.items) {
                    this.upsert(item);
                }
                break;
        }
    }

    setStatus(status: AgentStatus): ChatEvent {
        return this.patchInfo({ status });
    }

    /* A request can outlive the turn it came in, when work the CLI runs beside its turns asked it. */
    statusFor(activeTurnId: string | null): AgentStatus {
        if (this.pending().length > 0) {
            return 'needs-you';
        }
        return activeTurnId === null ? 'idle' : 'running';
    }

    pending(): Array<ChatApprovalItem | ChatQuestionItem> {
        return this.list().filter(
            (item): item is ChatApprovalItem | ChatQuestionItem =>
                (item.kind === 'approval' && item.decision === 'pending') || (item.kind === 'question' && item.state === 'pending')
        );
    }

    history(limit = 60, cursor?: string): ChatHistoryResult {
        let end = this.order.length;
        if (cursor) {
            const [generation, offset] = cursor.split(':');
            end = Number(offset);
            if (generation !== this.historyGeneration || !/^\d+$/.test(offset ?? '') || !Number.isSafeInteger(end) || end < 0 || end > this.order.length) {
                throw new ChatError('history-expired', 'The conversation changed. Reload its history.');
            }
        }
        const items: ChatItem[] = [];
        let bytes = 0;
        let start = end;
        while (start > 0 && items.length < Math.min(100, Math.max(1, limit))) {
            const item = this.items.get(this.order[start - 1]!)!;
            const size = Buffer.byteLength(JSON.stringify(item));
            // An atomic item is never cut; an oversized item travels alone.
            if (items.length && bytes + size > 512 * 1024) {
                break;
            }
            items.unshift(item);
            bytes += size;
            start--;
        }
        return { items, history: { start, cursor: start ? `${this.historyGeneration}:${start}` : null } };
    }

    snapshot(): { info: ChatInfo; items: ChatItem[] } {
        return { info: this.info, items: this.list() };
    }
}
