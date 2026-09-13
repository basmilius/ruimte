import type { AgentStatus, ChatEvent, ChatInfo, ChatItem } from '@ruimte/contracts';

/*
 * The state of one chat as the client sees it. Every mutation answers the event that describes
 * it, so the daemon broadcasts exactly what it applied and a reload can rebuild from `snapshot`.
 */
export class ChatThread {
    info: ChatInfo;
    private readonly items = new Map<string, ChatItem>();
    private readonly order: string[] = [];

    constructor(info: ChatInfo, items: ChatItem[] = []) {
        this.info = info;
        for (const item of items) {
            this.items.set(item.id, item);
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
            this.order.push(item.id);
        }
        this.items.set(item.id, item);
        return { type: 'item', item };
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
        this.order.length = 0;
        this.info = { ...this.info, ...patch };
        return { type: 'reset', info: this.info, items: [] };
    }

    setStatus(status: AgentStatus): ChatEvent {
        return this.patchInfo({ status });
    }

    snapshot(): { info: ChatInfo; items: ChatItem[] } {
        return { info: this.info, items: this.list() };
    }
}
