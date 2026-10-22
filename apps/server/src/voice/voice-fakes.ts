import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import type { LiveEvent, LiveSessionAnswer } from '@ruimte/voice';
import type { VoiceClock } from './clock.ts';
import { LiveError, type OpenAiLive } from './openai-live.ts';
import { LiveSideband, type LiveSocket, type SidebandHandlers } from './sideband.ts';
import type { VoiceChatEvent, VoiceFollowChats } from './voice-follower.ts';

/* A clock a test moves by hand, so every deadline runs without waiting. */
export class FakeClock implements VoiceClock {
    #now = 1_000_000;
    #timers: { at: number; run: () => void; cancelled: boolean }[] = [];

    now(): number {
        return this.#now;
    }

    after(ms: number, run: () => void): () => void {
        const timer = { at: this.#now + ms, run, cancelled: false };
        this.#timers.push(timer);
        return () => {
            timer.cancelled = true;
        };
    }

    get pending(): number {
        return this.#timers.filter((timer) => !timer.cancelled).length;
    }

    advance(ms: number): void {
        this.#now += ms;
        const due = this.#timers.filter((timer) => !timer.cancelled && timer.at <= this.#now).sort((left, right) => left.at - right.at);
        this.#timers = this.#timers.filter((timer) => !due.includes(timer) && !timer.cancelled);
        for (const timer of due) {
            timer.run();
        }
    }
}

/* A socket a test opens, feeds and closes by hand, and reads what the daemon sent on it. */
export class FakeSocket implements LiveSocket {
    readonly url: string;
    readonly key: string;
    readonly sent: LiveEvent[] = [];
    closedWith: number | null = null;
    #open: (() => void)[] = [];
    #message: ((data: string) => void)[] = [];
    #close: ((code: number) => void)[] = [];

    constructor(url: string, key: string) {
        this.url = url;
        this.key = key;
    }

    send(data: string): void {
        this.sent.push(JSON.parse(data) as LiveEvent);
    }

    close(code = 1000): void {
        this.drop(code);
    }

    onOpen(listener: () => void): void {
        this.#open.push(listener);
    }

    onMessage(listener: (data: string) => void): void {
        this.#message.push(listener);
    }

    onClose(listener: (code: number) => void): void {
        this.#close.push(listener);
    }

    open(): void {
        for (const listener of this.#open) {
            listener();
        }
    }

    receive(event: LiveEvent | string): void {
        const data = typeof event === 'string' ? event : JSON.stringify(event);
        for (const listener of this.#message) {
            listener(data);
        }
    }

    /* The other end went, or the daemon closed it. */
    drop(code = 1006): void {
        if (this.closedWith !== null) {
            return;
        }
        this.closedWith = code;
        for (const listener of this.#close) {
            listener(code);
        }
    }

    sentOf(type: string): LiveEvent[] {
        return this.sent.filter((event) => event.type === type);
    }
}

interface Pending<Value> {
    resolve(value: Value): void;
    reject(error: unknown): void;
}

function deferred<Value>(): { promise: Promise<Value> } & Pending<Value> {
    let resolve!: (value: Value) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<Value>((ok, fail) => {
        resolve = ok;
        reject = fail;
    });
    return { promise, resolve, reject };
}

export interface FakeAttach {
    sessionId: string;
    socket: FakeSocket;
    sideband: LiveSideband;
    handlers: SidebandHandlers;
    pending: Pending<LiveSideband>;
    signal: AbortSignal;
}

/*
 * GPT-Live as a test drives it: every mint and attach waits until the test answers it, so a test can stop,
 * fail or lose anything between any two steps of a start.
 */
export class FakeLive implements OpenAiLive {
    readonly clock: FakeClock;
    readonly mints: { key: string; body: Record<string, unknown>; signal: AbortSignal; pending: Pending<LiveSessionAnswer> }[] = [];
    readonly attaches: FakeAttach[] = [];
    readonly closed: string[] = [];
    #minted = 0;
    #mintWaiters: { count: number; resolve: () => void }[] = [];

    constructor(clock: FakeClock) {
        this.clock = clock;
    }

    mint(key: string, body: Record<string, unknown>, signal: AbortSignal): Promise<LiveSessionAnswer> {
        const pending = deferred<LiveSessionAnswer>();
        this.mints.push({ key, body, signal, pending });
        const due = this.#mintWaiters.filter((waiter) => waiter.count <= this.mints.length);
        this.#mintWaiters = this.#mintWaiters.filter((waiter) => !due.includes(waiter));
        for (const waiter of due) {
            waiter.resolve();
        }
        return pending.promise;
    }

    /* Resolves once this many mints came, for a start that reads the disk before it mints. */
    minting(count: number): Promise<void> {
        if (this.mints.length >= count) {
            return Promise.resolve();
        }
        return new Promise((resolve) => this.#mintWaiters.push({ count, resolve }));
    }

    attach(_key: string, sessionId: string, handlers: SidebandHandlers, signal: AbortSignal): Promise<LiveSideband> {
        const pending = deferred<LiveSideband>();
        const socket = new FakeSocket(`fake://${sessionId}`, _key);
        const sideband = new LiveSideband(socket, this.clock, handlers);
        this.attaches.push({ sessionId, socket, sideband, handlers, pending, signal });
        signal.addEventListener('abort', () => pending.reject(new LiveError('voice-cancelled', 'The Voice start was stopped')), { once: true });
        return pending.promise;
    }

    async close(_key: string, sessionId: string): Promise<void> {
        this.closed.push(sessionId);
    }

    /* Answers the oldest mint not answered yet with a new session. */
    answerMint(index = this.mints.length - 1): string {
        const sessionId = `live_${++this.#minted}`;
        this.mints[index]!.pending.resolve({ session: { id: sessionId }, transport: { type: 'webrtc', sdp: `answer-of-${sessionId}` } });
        return sessionId;
    }

    failMint(error: unknown, index = this.mints.length - 1): void {
        this.mints[index]!.pending.reject(error);
    }

    /* Opens the attach, which hands the session its sideband. */
    answerAttach(index = this.attaches.length - 1): FakeAttach {
        const attach = this.attaches[index]!;
        attach.socket.open();
        attach.pending.resolve(attach.sideband);
        return attach;
    }

    failAttach(index = this.attaches.length - 1): void {
        this.attaches[index]!.pending.reject(new LiveError('voice-attach-failed', 'The machine could not attach to the GPT-Live session'));
    }
}

/* Lets every promise that is already settled run its callbacks. */
export async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

/* The daemon's chats as the follower hears them: a test sets a chat's thread and says that it changed. */
export class FakeChats implements VoiceFollowChats {
    readonly #sinks = new Set<(event: VoiceChatEvent) => void>();
    readonly #threads = new Map<string, { items: ChatItem[]; info: Pick<ChatInfo, 'status' | 'activeTurnId'> }>();

    observe(sink: (event: VoiceChatEvent) => void): () => void {
        this.#sinks.add(sink);
        return () => {
            this.#sinks.delete(sink);
        };
    }

    thread(chatId: string): { items: readonly ChatItem[]; info: Pick<ChatInfo, 'status' | 'activeTurnId'> } | null {
        return this.#threads.get(chatId) ?? null;
    }

    get listening(): number {
        return this.#sinks.size;
    }

    /* Sets where a chat stands and tells every observer, as an item of that chat going out would. */
    set(chatId: string, items: ChatItem[], info: Pick<ChatInfo, 'status' | 'activeTurnId'>, type: 'item' | 'info' | 'delta' = 'item'): void {
        this.#threads.set(chatId, { items, info });
        for (const sink of this.#sinks) {
            sink({ event: 'chat.event', payload: { chatId, event: { type } } });
        }
    }
}
