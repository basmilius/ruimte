import type { LiveEvent } from './live-event.ts';
import { parseLiveToolEvent, type LiveFunctionCall } from './tool-events.ts';

/* Sees the loop at work, for the diagnostics; it never changes what the loop does. */
export interface ToolLoopObserver {
    responseEvent(delegationId: string, type: string): void;
    responseRequested(delegationId: string): void;
    callStarted(delegationId: string, callId: string, tool: string, rawArguments: string): void;
    callFinished(callId: string, output: Record<string, unknown>): void;
}

export type VoiceToolSend = (event: LiveEvent) => void;
/* The call id is the service's: an executor that has to answer a retried call as the same one keys on it. */
export type VoiceToolExecute = (name: string, args: string, callId: string) => Promise<Record<string, unknown>>;

export interface VoiceToolLoopOptions {
    /* The tools the session offered; a call to any other is left alone. */
    toolNames: ReadonlySet<string>;
    observer?: ToolLoopObserver | null;
}

/*
 * Runs each function call of a delegated response once, sends its output, and asks for the next response
 * once every call of that delegation answered. Sending and running are the caller's, so the desktop's data
 * channel and the daemon's sideband share one loop.
 */
export class VoiceToolLoop {
    readonly #send: VoiceToolSend;
    readonly #execute: VoiceToolExecute;
    readonly #toolNames: ReadonlySet<string>;
    readonly #calls = new Set<string>();
    readonly #pending = new Map<string, Promise<void>[]>();
    readonly #observer: ToolLoopObserver | null;

    constructor(send: VoiceToolSend, execute: VoiceToolExecute, { toolNames, observer = null }: VoiceToolLoopOptions) {
        this.#send = send;
        this.#execute = execute;
        this.#toolNames = toolNames;
        this.#observer = observer;
    }

    handle(event: LiveEvent): void {
        const observed = parseLiveToolEvent(event, this.#toolNames);
        if (!observed) {
            return;
        }
        this.#observer?.responseEvent(observed.delegationId, observed.type);
        const call = observed.call;
        if (call && !this.#calls.has(call.callId)) {
            this.#calls.add(call.callId);
            this.#observer?.callStarted(observed.delegationId, call.callId, call.name, call.arguments);
            const run = this.#run(call);
            const pending = this.#pending.get(observed.delegationId) ?? [];
            pending.push(run);
            this.#pending.set(observed.delegationId, pending);
            return;
        }
        if (observed.type !== 'response.completed') {
            return;
        }
        const delegationId = observed.delegationId;
        const pending = this.#pending.get(delegationId);
        if (pending?.length) {
            this.#pending.delete(delegationId);
            void Promise.all(pending).then(() => {
                this.#observer?.responseRequested(delegationId);
                this.#send({ type: 'response.create', event_id: crypto.randomUUID() });
            });
        }
    }

    reset(): void {
        this.#calls.clear();
        this.#pending.clear();
    }

    async #run(call: LiveFunctionCall): Promise<void> {
        let output: Record<string, unknown>;
        try {
            output = await this.#execute(call.name, call.arguments, call.callId);
        } catch (error) {
            output = { ok: false, code: 'tool-error', message: error instanceof Error ? error.message : 'The Ruimte tool failed.' };
        }
        this.#observer?.callFinished(call.callId, output);
        this.#send({
            type: 'response.item.create',
            event_id: crypto.randomUUID(),
            item: { type: 'function_call_output', call_id: call.callId, output: JSON.stringify(output) }
        });
    }
}
