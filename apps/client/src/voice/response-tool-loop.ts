import { VOICE_TOOL_DEFINITIONS } from '@ruimte/actions';
import type { LiveEvent } from '@/voice/live-session';

interface FunctionCall {
    callId: string;
    name: string;
    arguments: string;
}

type Send = (event: LiveEvent) => void;

/* Sees the loop at work, for the diagnostics; it never changes what the loop does. */
export interface ToolLoopObserver {
    responseEvent(delegationId: string, type: string): void;
    responseRequested(delegationId: string): void;
    callStarted(delegationId: string, callId: string, tool: string, rawArguments: string): void;
    callFinished(callId: string, output: Record<string, unknown>): void;
}
type Execute = (name: string, args: string) => Promise<Record<string, unknown>>;

const toolNames = new Set<string>(VOICE_TOOL_DEFINITIONS.map((tool) => tool.name));

const functionCallOf = (event: LiveEvent): FunctionCall | null => {
    if (event.type !== 'response.event' || typeof event.event !== 'object' || event.event === null) {
        return null;
    }
    const nested = event.event as { type?: unknown; item?: unknown };
    if (nested.type !== 'response.output_item.done' || typeof nested.item !== 'object' || nested.item === null) {
        return null;
    }
    const item = nested.item as { type?: unknown; call_id?: unknown; name?: unknown; arguments?: unknown };
    if (
        item.type !== 'function_call' ||
        typeof item.call_id !== 'string' ||
        typeof item.name !== 'string' ||
        !toolNames.has(item.name) ||
        typeof item.arguments !== 'string'
    ) {
        return null;
    }
    return { callId: item.call_id, name: item.name, arguments: item.arguments };
};

const responseEventOf = (event: LiveEvent): { delegationId: string; type: string } | null => {
    if (event.type !== 'response.event' || typeof event.delegation_id !== 'string' || typeof event.event !== 'object' || event.event === null) {
        return null;
    }
    const type = (event.event as { type?: unknown }).type;
    return typeof type === 'string' ? { delegationId: event.delegation_id, type } : null;
};

const completedDelegationOf = (event: LiveEvent): string | null => {
    if (event.type !== 'response.event' || typeof event.delegation_id !== 'string' || typeof event.event !== 'object' || event.event === null) {
        return null;
    }
    return (event.event as { type?: unknown }).type === 'response.completed' ? event.delegation_id : null;
};

export class ResponseToolLoop {
    readonly #send: Send;
    readonly #execute: Execute;
    readonly #calls = new Set<string>();
    readonly #pending = new Map<string, Promise<void>[]>();
    readonly #observer: ToolLoopObserver | null;

    constructor(send: Send, execute: Execute, observer: ToolLoopObserver | null = null) {
        this.#send = send;
        this.#execute = execute;
        this.#observer = observer;
    }

    handle(event: LiveEvent): void {
        const observed = responseEventOf(event);
        if (observed) {
            this.#observer?.responseEvent(observed.delegationId, observed.type);
        }
        const call = functionCallOf(event);
        if (call && typeof event.delegation_id === 'string' && !this.#calls.has(call.callId)) {
            this.#calls.add(call.callId);
            this.#observer?.callStarted(event.delegation_id, call.callId, call.name, call.arguments);
            const run = this.#run(call);
            const pending = this.#pending.get(event.delegation_id) ?? [];
            pending.push(run);
            this.#pending.set(event.delegation_id, pending);
            return;
        }
        const delegationId = completedDelegationOf(event);
        if (delegationId) {
            const pending = this.#pending.get(delegationId);
            if (pending?.length) {
                this.#pending.delete(delegationId);
                void Promise.all(pending).then(() => {
                    this.#observer?.responseRequested(delegationId);
                    this.#send({ type: 'response.create', event_id: crypto.randomUUID() });
                });
            }
        }
    }

    reset(): void {
        this.#calls.clear();
        this.#pending.clear();
    }

    async #run(call: FunctionCall): Promise<void> {
        let output: Record<string, unknown>;
        try {
            output = await this.#execute(call.name, call.arguments);
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
