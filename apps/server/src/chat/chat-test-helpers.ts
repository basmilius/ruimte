import type { ChatCheckpointDiff, ChatEvent, ChatInfo, ChatItem } from '@ruimte/contracts';
import type { CheckpointService } from '../git/checkpoints.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { ChatStore } from '@ruimte/agents/chat/chat-store';

type Check = () => boolean;

/*
 * What one client of a chat has seen. `until` is checked again on every event instead of on a
 * clock, so a test waits exactly as long as the chat takes and a wait that never ends is a bug.
 */
export class ChatRecorder {
    readonly events: ChatEvent[] = [];
    readonly items = new Map<string, ChatItem>();
    /* What `chat.status` told this client, which needs no attach at all. */
    readonly statuses: ChatInfo[] = [];
    info: ChatInfo | null = null;
    private waiters: Array<{ check: Check; resolve(): void }> = [];

    sink() {
        return (event: SessionEvent): void => {
            if (event.event === 'chat.status') {
                this.statuses.push(event.payload.info);
                this.recheck();
                return;
            }
            if (event.event !== 'chat.event') {
                return;
            }
            const chatEvent = event.payload.event;
            this.events.push(chatEvent);
            if (chatEvent.type === 'item') {
                this.items.set(chatEvent.item.id, chatEvent.item);
            } else if (chatEvent.type === 'delta') {
                const item = this.items.get(chatEvent.itemId);
                if (item?.kind === 'assistant') {
                    this.items.set(item.id, { ...item, text: item.text + chatEvent.text });
                }
            } else if (chatEvent.type === 'reset') {
                this.items.clear();
                this.info = chatEvent.info;
            } else {
                this.info = chatEvent.info;
            }
            this.recheck();
        };
    }

    until(check: Check): Promise<void> {
        if (check()) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.waiters.push({ check, resolve });
        });
    }

    ofKind<K extends ChatItem['kind']>(kind: K): Array<Extract<ChatItem, { kind: K }>> {
        return [...this.items.values()].filter((item): item is Extract<ChatItem, { kind: K }> => item.kind === kind);
    }

    get deltas(): string {
        return this.events
            .filter((event) => event.type === 'delta')
            .map((event) => (event.type === 'delta' ? event.text : ''))
            .join('');
    }

    private recheck(): void {
        const waiting = this.waiters;
        this.waiters = [];
        for (const waiter of waiting) {
            if (waiter.check()) {
                waiter.resolve();
            } else {
                this.waiters.push(waiter);
            }
        }
    }
}

type ChatRecord = { info: ChatInfo; items: ChatItem[] };

type ChatStoreWriteRest = Parameters<ChatStore['write']> extends [string, ChatInfo, ChatItem[], ...infer Rest] ? Rest : never;

/* A store that says when a write landed, so a test reads the file after the write and not after a guess. */
export class RecordingStore extends ChatStore {
    // Every write as it lands and every delete as it is asked for, in that order.
    readonly calls: string[] = [];
    private readonly latest = new Map<string, ChatRecord>();
    private waiters: Array<{ chatId: string; check(record: ChatRecord): boolean; resolve(): void }> = [];
    private held: { chatId: string; gate: Promise<void>; entered(): void; landed(): void } | null = null;

    /* Keeps the next write of a chat from reaching the disk until released: a write that is still out. */
    holdNextWrite(chatId: string): { entered: Promise<void>; release(): void; landed: Promise<void> } {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let entered: () => void = () => undefined;
        const reached = new Promise<void>((resolve) => {
            entered = resolve;
        });
        let landed: () => void = () => undefined;
        const written = new Promise<void>((resolve) => {
            landed = resolve;
        });
        this.held = { chatId, gate, entered, landed };
        return { entered: reached, release, landed: written };
    }

    override async delete(chatId: string): Promise<void> {
        this.calls.push(`delete ${chatId}`);
        await super.delete(chatId);
    }

    override async write(chatId: string, info: ChatInfo, items: ChatItem[], ...rest: ChatStoreWriteRest): Promise<number> {
        const held = this.held?.chatId === chatId ? this.held : null;
        if (held !== null) {
            this.held = null;
            held.entered();
            await held.gate;
        }
        const size = await super.write(chatId, info, items, ...rest);
        this.calls.push(`write ${chatId}`);
        held?.landed();
        const record = { info, items };
        this.latest.set(chatId, record);
        const waiting = this.waiters;
        this.waiters = [];
        for (const waiter of waiting) {
            if (waiter.chatId === chatId && waiter.check(record)) {
                waiter.resolve();
            } else {
                this.waiters.push(waiter);
            }
        }
        return size;
    }

    /* Resolves once the last finished write of the chat holds what `check` looks for. */
    written(chatId: string, check: (record: ChatRecord) => boolean): Promise<void> {
        const latest = this.latest.get(chatId);
        if (latest && check(latest)) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.waiters.push({ chatId, check, resolve });
        });
    }
}

/* Checkpoints without git: every turn gets the same tree and every diff the same answer. */
export class FakeCheckpoints implements CheckpointService {
    private readonly tree: string | null;
    private readonly answer: ChatCheckpointDiff | null;
    private readonly handedOut: Promise<unknown>[] = [];

    constructor(tree: string | null, answer: ChatCheckpointDiff | null) {
        this.tree = tree;
        this.answer = answer;
    }

    take(): Promise<string | null> {
        const taken = Promise.resolve(this.tree);
        this.handedOut.push(taken);
        return taken;
    }

    diff(): Promise<ChatCheckpointDiff | null> {
        const diffed = Promise.resolve(this.answer);
        this.handedOut.push(diffed);
        return diffed;
    }

    settle(): Promise<{ diff: ChatCheckpointDiff; after: string } | null> {
        const settled = Promise.resolve(this.answer === null || this.tree === null ? null : { diff: this.answer, after: this.tree });
        this.handedOut.push(settled);
        return settled;
    }

    /* Resolves once every answer handed out so far, and whatever those answers set off, has settled. */
    async settled(): Promise<void> {
        let count = -1;
        while (count !== this.handedOut.length) {
            count = this.handedOut.length;
            await Promise.all(this.handedOut);
        }
    }
}
