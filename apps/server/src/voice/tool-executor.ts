import { ACTION_DEFINITIONS, VOICE_CONTROL_TOOL, type ActionCall, type ActionName, type ActionResult, type VoiceToolDefinition } from '@ruimte/actions';
import { voiceReplyOf } from '@ruimte/voice';
import type { VoicePolicy } from './action-policy.ts';

export type VoiceToolOutput = Record<string, unknown>;

/* The registry as the executor reaches it: the daemon's `serverActions`, or a fake in a test. */
export interface VoiceActionRunner<Context> {
    execute(name: ActionName, input: unknown, call: ActionCall<Context>): Promise<ActionResult>;
    confirm(token: string, approved: boolean, call: ActionCall<Context>): Promise<ActionResult>;
}

/* Sees each call start and end, for the timeline the phone draws; never the arguments or the output. */
export interface VoiceToolObserver {
    started(callId: string, name: ActionName): void;
    finished(callId: string, name: ActionName, ok: boolean): void;
}

export interface VoiceToolExecutorOptions<Context> {
    sessionId: string;
    runner: VoiceActionRunner<Context>;
    policy: VoicePolicy;
    /* The tools the session was minted with; a call to an action none of them offered is refused. */
    tools: readonly VoiceToolDefinition[];
    /* The call of this session's voice actor, built when an action runs so its place follows the project. */
    call(): ActionCall<Context>;
    /* Whether the session still runs; a call that waited past its end does nothing. */
    live(): boolean;
    observer?: VoiceToolObserver;
}

// Reads may overlap this far; every change runs alone, in the order the calls came.
const PARALLEL_READS = 4;
// A session that asks more than this is a loop, not a conversation, and is refused from then on.
export const MAX_CALLS_PER_SESSION = 500;
// Calls kept to answer a repeated call id with the same promise.
const CALL_MEMORY = 256;
// Confirmations this session handed out and may still be answered.
const CONFIRMATION_MEMORY = 32;

/* The words of a reply only reach the model, so they stay English; the timeline takes its label from the catalog. */
const REPLY_WORDS = { activity: () => '', machine: (endpointId: string) => endpointId };

function refused(code: string, message: string): VoiceToolOutput {
    return { ok: false, code, message };
}

function objectArguments(raw: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/* What each tool reaches, read from the tools themselves, so the executor offers exactly what the model was given. */
function offeredActions(tools: readonly VoiceToolDefinition[]): Map<string, ReadonlySet<string>> {
    const offered = new Map<string, ReadonlySet<string>>();
    for (const tool of tools) {
        const action = tool.parameters.properties.action as { enum?: unknown } | undefined;
        if (Array.isArray(action?.enum)) {
            offered.set(tool.name, new Set(action.enum.filter((name): name is string => typeof name === 'string')));
        }
    }
    return offered;
}

/* A strict tool carries every field of its domain; the action gets only its own, and the registry validates those. */
function inputOf(name: ActionName, args: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.keys(ACTION_DEFINITIONS[name].input.shape).map((field) => [field, args[field] ?? null]));
}

/* A counted gate: at most `size` of what it runs go at once. */
class Gate {
    readonly #size: number;
    #running = 0;
    readonly #waiting: (() => void)[] = [];

    constructor(size: number) {
        this.#size = size;
    }

    async run<Value>(work: () => Promise<Value>): Promise<Value> {
        if (this.#running >= this.#size) {
            await new Promise<void>((resolve) => this.#waiting.push(resolve));
        }
        this.#running += 1;
        try {
            return await work();
        } finally {
            this.#running -= 1;
            this.#waiting.shift()?.();
        }
    }
}

/*
 * Runs the tool calls of one Voice session through the daemon's registry, behind the policy of that
 * session. Every call is checked before the registry sees it, and a confirmation is checked again before
 * it is answered, so an action outside the matrix is never run, not even through a token.
 */
export class VoiceToolExecutor<Context> {
    readonly #options: VoiceToolExecutorOptions<Context>;
    readonly #offered: Map<string, ReadonlySet<string>>;
    readonly #calls = new Map<string, Promise<VoiceToolOutput>>();
    readonly #confirmations = new Map<string, { name: ActionName; input: Record<string, unknown> }>();
    readonly #reads = new Gate(PARALLEL_READS);
    #changes: Promise<unknown> = Promise.resolve();
    #count = 0;

    constructor(options: VoiceToolExecutorOptions<Context>) {
        this.#options = options;
        this.#offered = offeredActions(options.tools);
    }

    /* Runs a call once per call id: a repeated event gets the promise of the first. */
    execute(tool: string, rawArguments: string, callId: string): Promise<VoiceToolOutput> {
        const known = this.#calls.get(callId);
        if (known) {
            return known;
        }
        const running = this.#run(tool, rawArguments, callId);
        if (this.#calls.size >= CALL_MEMORY) {
            const oldest = this.#calls.keys().next().value;
            if (oldest !== undefined) {
                this.#calls.delete(oldest);
            }
        }
        this.#calls.set(callId, running);
        return running;
    }

    /* The person's answer from the phone or the model's through the control tool, which go to the same confirmation. */
    async confirm(token: string, approved: boolean): Promise<VoiceToolOutput> {
        const pending = this.#confirmations.get(token);
        if (pending === undefined || !this.#options.live()) {
            return refused('unknown-confirmation', 'This confirmation is no longer available.');
        }
        this.#confirmations.delete(token);
        const refusal = this.#options.policy.check(pending.name, pending.input);
        if (refusal !== null) {
            return refused(refusal.code, refusal.message);
        }
        const run = (): Promise<VoiceToolOutput> => this.#runner(pending.name, () => this.#options.runner.confirm(token, approved, this.#options.call()));
        return this.#queue(pending.name, run);
    }

    async #run(tool: string, rawArguments: string, callId: string): Promise<VoiceToolOutput> {
        this.#count += 1;
        if (this.#count > MAX_CALLS_PER_SESSION) {
            return refused('voice-call-limit', 'This Voice session made too many calls; start a new one.');
        }
        const args = objectArguments(rawArguments);
        if (args === null) {
            return refused('invalid-arguments', 'The tool arguments are not a JSON object.');
        }
        if (tool === VOICE_CONTROL_TOOL) {
            const token = typeof args.confirmation_token === 'string' ? args.confirmation_token : null;
            if (token === null || (args.action !== 'confirm' && args.action !== 'cancel')) {
                return refused('invalid-confirmation', 'Choose confirm or cancel and provide the confirmation token.');
            }
            return this.confirm(token, args.action === 'confirm');
        }
        const name = typeof args.action === 'string' ? args.action : '';
        if (!this.#offered.get(tool)?.has(name)) {
            return refused('not-offered', `The tool ${tool} offers no action “${name}”.`);
        }
        const input = inputOf(name as ActionName, args);
        const refusal = this.#options.policy.check(name, input);
        if (refusal !== null) {
            return refused(refusal.code, refusal.message);
        }
        if (name === 'agent.start') {
            // The model's own id is never trusted: one per call, so a repeated call is the same start and a new call a new one.
            input.requestId = `voice:${this.#options.sessionId}:${callId}`;
        }
        const action = name as ActionName;
        this.#options.observer?.started(callId, action);
        const output = await this.#queue(action, () =>
            this.#runner(action, async () => {
                const result = await this.#options.runner.execute(action, input, this.#options.call());
                if (result.status === 'needs_confirmation') {
                    this.#remember(result.confirmationToken, action, input);
                }
                return result;
            })
        );
        this.#options.observer?.finished(callId, action, output.ok === true);
        return output;
    }

    /* Reads overlap up to the gate; a change waits for every change before it. */
    #queue(name: ActionName, run: () => Promise<VoiceToolOutput>): Promise<VoiceToolOutput> {
        if (ACTION_DEFINITIONS[name].effect === 'read') {
            return this.#reads.run(run);
        }
        const next = this.#changes.then(run, run);
        this.#changes = next.catch(() => undefined);
        return next;
    }

    async #runner(name: ActionName, run: () => Promise<ActionResult>): Promise<VoiceToolOutput> {
        if (!this.#options.live()) {
            return refused('voice-ended', 'This Voice session has ended.');
        }
        try {
            return this.#outputOf(await run());
        } catch {
            // The message of an unexpected error may quote what it failed on, so the model hears only that it failed.
            return refused('tool-error', `“${name}” failed on this machine.`);
        }
    }

    #outputOf(result: ActionResult): VoiceToolOutput {
        switch (result.status) {
            case 'completed': {
                const output = result.output as Record<string, unknown>;
                return { ok: true, message: voiceReplyOf(result.action, output, REPLY_WORDS).message, ...output };
            }
            case 'queued':
            case 'running':
                return { ok: true, status: result.status, operationId: result.operationId, ...(result.output as Record<string, unknown>) };
            case 'needs_confirmation':
                return {
                    ok: false,
                    message: 'Ask the user to confirm or cancel this action before continuing.',
                    needs_confirmation: true,
                    confirmation_token: result.confirmationToken,
                    confirmation: result.confirmation
                };
            case 'failed':
                return refused(result.error.code, result.error.message);
        }
    }

    #remember(token: string, name: ActionName, input: Record<string, unknown>): void {
        if (this.#confirmations.size >= CONFIRMATION_MEMORY) {
            const oldest = this.#confirmations.keys().next().value;
            if (oldest !== undefined) {
                this.#confirmations.delete(oldest);
            }
        }
        this.#confirmations.set(token, { name, input });
    }
}
