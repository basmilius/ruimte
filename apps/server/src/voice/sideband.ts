import type { LiveEvent } from '@ruimte/voice';
import type { VoiceClock } from './clock.ts';

/* What the daemon needs of the WebSocket it attaches with; Bun's in the daemon, a fake in a test. */
export interface LiveSocket {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    onOpen(listener: () => void): void;
    onMessage(listener: (data: string) => void): void;
    /* Called once, when the socket is gone for whatever reason, a failed open included. */
    onClose(listener: (code: number) => void): void;
}

export type LiveSocketOpener = (url: string, key: string) => LiveSocket;

/* The key rides in a header and never in the address, so no proxy or log of a URL ever holds it. */
export function bunLiveSocket(url: string, key: string): LiveSocket {
    // Bun's constructor takes headers; the DOM's type in the compiler's view of WebSocket knows only protocols.
    const options: Bun.WebSocketOptions = { headers: { Authorization: `Bearer ${key}` } };
    const socket = new WebSocket(url, options as unknown as string[]);
    return {
        send: (data) => socket.send(data),
        close: (code, reason) => socket.close(code, reason),
        onOpen: (listener) => socket.addEventListener('open', () => listener()),
        onMessage: (listener) => socket.addEventListener('message', (message) => listener(typeof message.data === 'string' ? message.data : '')),
        onClose: (listener) => socket.addEventListener('close', (event) => listener(event.code))
    };
}

/*
 * The audio OpenAI echoes on a sideband, both ways (`session.input_audio.append`, `session.output_audio.delta`,
 * and anything else named for audio or its buffer). The daemon never needs it, so it is dropped as it comes in,
 * before anything could log, count or keep it.
 */
export function isAudioEvent(type: string): boolean {
    return /(^|[._])(input_|output_)?audio([._]|$)/.test(type) || type.includes('audio_buffer');
}

/*
 * Events only a client sends. One coming back on the sideband that the daemon did not send means another
 * client, the phone's data channel, drives the session; the mint cannot yet say which events a data
 * channel may send, so this is how the daemon finds out.
 */
const CLIENT_EVENTS: ReadonlySet<string> = new Set([
    'response.create',
    'response.item.create',
    'session.update',
    'session.instructions.append',
    'session.thinking.append',
    'session.commentary.append'
]);

export interface SidebandHandlers {
    event(event: LiveEvent): void;
    /* The socket went without the daemon closing it. */
    lost(code: number): void;
}

// How long a close waits for `session.closed` before it lets the socket go regardless.
export const SIDEBAND_CLOSE_WAIT_MS = 3000;
// Event ids the daemon sent, kept to tell its own events from another client's.
const SENT_MEMORY = 512;

function parsed(data: string): LiveEvent | null {
    try {
        const value: unknown = JSON.parse(data);
        return typeof value === 'object' && value !== null && typeof (value as LiveEvent).type === 'string' ? (value as LiveEvent) : null;
    } catch {
        // Neither the frame nor the parser's message, which quotes it.
        return null;
    }
}

/*
 * The daemon's own connection to a GPT-Live session, beside the phone's media peer. It sends tool outputs
 * and reports and hears transcripts and delegations; it never carries audio.
 */
export class LiveSideband {
    readonly #socket: LiveSocket;
    readonly #clock: VoiceClock;
    readonly #handlers: SidebandHandlers;
    readonly #sent = new Set<string>();
    readonly #answered = new Set<string>();
    #closing: Promise<void> | null = null;
    #closedWaiter: (() => void) | null = null;
    #gone = false;
    // OpenAI said the session is closed, so a close of the daemon's own has nothing left to wait for.
    #serviceClosed = false;

    constructor(socket: LiveSocket, clock: VoiceClock, handlers: SidebandHandlers) {
        this.#socket = socket;
        this.#clock = clock;
        this.#handlers = handlers;
        socket.onMessage((data) => this.#received(data));
        socket.onClose((code) => {
            if (this.#gone) {
                return;
            }
            this.#gone = true;
            this.#closedWaiter?.();
            if (this.#closing === null) {
                handlers.lost(code);
            }
        });
    }

    get closed(): boolean {
        return this.#gone || this.#closing !== null;
    }

    send(event: LiveEvent): boolean {
        if (this.closed) {
            return false;
        }
        if (typeof event.event_id === 'string') {
            this.#remember(this.#sent, event.event_id);
        }
        const item = event.item as { type?: unknown; call_id?: unknown } | undefined;
        if (event.type === 'response.item.create' && item?.type === 'function_call_output' && typeof item.call_id === 'string') {
            this.#remember(this.#answered, item.call_id);
        }
        this.#socket.send(JSON.stringify(event));
        return true;
    }

    /* Whether an event that came in is a client's the daemon never sent: the phone answering a tool or steering the session. */
    foreign(event: LiveEvent): boolean {
        if (CLIENT_EVENTS.has(event.type)) {
            return !(typeof event.event_id === 'string' && this.#sent.has(event.event_id));
        }
        if (event.type !== 'response.event' || typeof event.event !== 'object' || event.event === null) {
            return false;
        }
        const nested = event.event as { item?: { type?: unknown; call_id?: unknown } };
        const item = nested.item;
        return item?.type === 'function_call_output' && typeof item.call_id === 'string' && !this.#answered.has(item.call_id);
    }

    /* Ends the session at OpenAI: `session.close`, then at most a few seconds for `session.closed`, then the socket goes. */
    close(): Promise<void> {
        this.#closing ??= this.#close();
        return this.#closing;
    }

    async #close(): Promise<void> {
        if (!this.#gone && !this.#serviceClosed) {
            this.#socket.send(JSON.stringify({ type: 'session.close', event_id: crypto.randomUUID() }));
            await new Promise<void>((resolve) => {
                const cancel = this.#clock.after(SIDEBAND_CLOSE_WAIT_MS, () => resolve());
                this.#closedWaiter = () => {
                    cancel();
                    resolve();
                };
            });
        }
        this.#closedWaiter = null;
        if (!this.#gone) {
            this.#gone = true;
            this.#socket.close(1000, 'Voice ended');
        }
    }

    #received(data: string): void {
        const event = parsed(data);
        if (event === null || isAudioEvent(event.type)) {
            return;
        }
        if (event.type === 'session.closed') {
            this.#serviceClosed = true;
            this.#closedWaiter?.();
        }
        this.#handlers.event(event);
    }

    #remember(memory: Set<string>, id: string): void {
        if (memory.size >= SENT_MEMORY) {
            const oldest = memory.values().next().value;
            if (oldest !== undefined) {
                memory.delete(oldest);
            }
        }
        memory.add(id);
    }
}
