import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { RuntimeMode } from '@ruimte/contracts';
import type { ApprovalDecision, BackendHost, BackendLaunch, ChatBackend, TurnInput } from '@adecore/agents/chat';
import { ANTHROPIC_URL, anthropicHeaders, anthropicHttpError, type AnthropicClaudeApiService } from '../providers/anthropic-claude-api-service.ts';
import {
    ApiTools,
    CONTINUE_MESSAGE,
    INTERRUPTED,
    apiInstructions,
    endTurn,
    readThread,
    writeThread,
    type ApiToolDefinition,
    type ToolRounds
} from './api-chat.ts';
import { executeNanoTool, nanoEffectiveMode } from './nanogpt-tools.ts';
import { readAnthropicStream, type AnthropicToolUse, type AnthropicUsage, type AnthropicTurn } from './anthropic-claude-api-stream.ts';
import { cancellableTimeout, type Timer } from '@adecore/agents';

const BlockSchema = z.union([
    z.object({ type: z.literal('thinking'), thinking: z.string(), signature: z.string() }),
    z.object({ type: z.literal('redacted_thinking'), data: z.string() }),
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()) }),
    z.object({ type: z.literal('tool_result'), tool_use_id: z.string(), content: z.string(), is_error: z.boolean().optional() })
]);
type Block = z.infer<typeof BlockSchema>;
type ToolResult = Extract<Block, { type: 'tool_result' }>;

const MessageSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.union([z.string(), z.array(BlockSchema)]) });
type Message = z.infer<typeof MessageSchema>;

const NAME = 'The Claude API';

/*
 * A request fails only once Anthropic sent nothing for this long, never on its total length: a long reply with
 * thinking can stream for many minutes, and the API pings an open stream well within it.
 */
export const STREAM_IDLE_MS = 120_000;

/* Runs `run` after `ms` unless the function it hands back cancels it first. */
export type IdleTimer = Timer;

interface AnthropicClaudeApiBackendOptions {
    executeTool?: typeof executeNanoTool;
    limits?: ToolRounds;
    idleTimer?: IdleTimer;
}

async function* touching(body: AsyncIterable<Uint8Array>, touch: () => void): AsyncIterable<Uint8Array> {
    for await (const chunk of body) {
        touch();
        yield chunk;
    }
}

/* The tools in the form this API takes: the schema is `input_schema`, and the last one carries a cache mark. */
function anthropicTools(tools: ApiToolDefinition[]) {
    return tools.map((tool, index) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
        ...(index === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {})
    }));
}

/*
 * A chat on the API of Claude, its thread kept beside the key as `<session id>.json`. Every request marks its
 * system prompt, its tools and its last message for the cache, which is what keeps a long loop affordable.
 */
export class AnthropicClaudeApiBackend implements ChatBackend {
    private opened = false;
    private controller: AbortController | null = null;
    private work: Promise<void> | null = null;
    private messages: Message[] = [];
    private readonly sessionId: string;
    private readonly path: string;
    private readonly launch: BackendLaunch;
    private readonly host: BackendHost;
    private readonly service: AnthropicClaudeApiService;
    private readonly tools: ApiTools;
    private readonly limitsOverride: ToolRounds | undefined;
    private readonly idleTimer: IdleTimer;
    readonly pid = null;
    private readonly mode: RuntimeMode;

    constructor(launch: BackendLaunch, host: BackendHost, service: AnthropicClaudeApiService, options: AnthropicClaudeApiBackendOptions = {}) {
        this.launch = launch;
        this.host = host;
        this.service = service;
        this.limitsOverride = options.limits;
        this.idleTimer = options.idleTimer ?? cancellableTimeout;
        // A change of mode restarts the backend, so the mode it started with holds for its whole life.
        this.mode = nanoEffectiveMode(launch.runtimeMode);
        this.tools = new ApiTools({
            launch,
            host,
            mode: this.mode,
            approval: 'The Claude API requests access to this project.',
            home: service.directory,
            executeTool: options.executeTool ?? executeNanoTool
        });
        this.sessionId = launch.resume ?? randomUUID();
        if (!z.string().uuid().safeParse(this.sessionId).success) {
            throw new Error('Invalid Claude API session id.');
        }
        this.path = join(service.directory, `${this.sessionId}.json`);
    }
    get running(): boolean {
        return this.opened;
    }
    async start(): Promise<void> {
        if (this.opened) {
            return;
        }
        if (!this.service.apiKey) {
            throw new Error('Add an Anthropic API key in Settings → Providers.');
        }
        if (!this.service.catalog.resolveModel(this.launch.selection.model)) {
            throw new Error('Refresh the Claude API models in Settings.');
        }
        if (this.launch.resume) {
            this.messages = await readThread(this.path, z.array(MessageSchema), NAME);
            this.repairPendingTools();
        }
        this.opened = true;
        this.host.onEvent({
            type: 'session',
            agentSessionId: this.sessionId,
            model: this.launch.selection.model,
            effectiveRuntimeMode: this.mode,
            permissionMode: this.mode
        });
    }
    sendTurn(input: TurnInput): void {
        if (!this.opened || this.controller) {
            throw new Error('The Claude API is not ready for a new turn.');
        }
        if (input.attachments.length || input.skills.length || input.mentions.length) {
            this.host.onEvent({
                type: 'turn.done',
                state: 'error',
                costUsd: 0,
                error: 'The Claude API chat accepts text and project tools. Attachments and skill chips are unavailable.'
            });
            return;
        }
        const controller = new AbortController();
        this.controller = controller;
        this.work = this.run(input, controller);
    }
    private async run(input: TurnInput, controller: AbortController): Promise<void> {
        let failure: string | undefined;
        try {
            const prompt = [input.preamble, input.text].filter(Boolean).join('\n\n');
            // After a stopped turn the thread ends in the results of its calls, and the next message joins them: a user turn is one message.
            if (this.messages.at(-1)?.role === 'user') {
                this.addToUser({ type: 'text', text: prompt });
            } else {
                this.messages.push({ role: 'user', content: prompt });
            }
            await this.save();
            // Read as the run starts, so a change in Settings holds from the next message.
            const limits = this.limitsOverride ?? this.service.runLimits();
            const rounds = limits.roundsPerRun * limits.runs;
            for (let round = 0; round < rounds; round++) {
                controller.signal.throwIfAborted();
                if (round > 0 && round % limits.roundsPerRun === 0) {
                    this.host.onEvent({ type: 'note', level: 'info', text: `Continuing after ${round} tool rounds.` });
                    this.addToUser({ type: 'text', text: CONTINUE_MESSAGE });
                    await this.save();
                }
                if (!this.service.apiKey) {
                    throw new Error('The Claude API was disconnected in Settings.');
                }
                const ref = randomUUID();
                const turn = await this.exchange(ref, controller.signal);
                controller.signal.throwIfAborted();
                for (const part of turn.parts) {
                    const partRef = `${ref}-${part.index}`;
                    if (part.type === 'text') {
                        this.host.onEvent({ type: 'text.done', ref: partRef, text: part.text });
                    } else {
                        this.host.onEvent({ type: 'thinking.done', ref: partRef, text: part.text });
                    }
                }
                if (turn.content.length > 0) {
                    this.messages.push({ role: 'assistant', content: turn.content });
                    await this.save();
                }
                if (turn.stopReason === 'max_tokens') {
                    throw new Error('The Claude API reply was cut at its limit of output tokens. Raise it in Settings, or ask for less at a time.');
                }
                if (turn.stopReason === 'refusal') {
                    throw new Error('Claude declined to answer this.');
                }
                if (turn.toolCalls.length === 0) {
                    return;
                }
                await this.runTools(turn.toolCalls, controller.signal);
            }
            throw new Error(`The Claude API reached ${rounds} tool rounds. Send another message to continue.`);
        } catch (error) {
            // Never forward fetch errors or raw remote bodies: these can contain credentials.
            failure =
                error instanceof Error &&
                (error.message.startsWith('Anthropic') || error.message.startsWith('The Claude API') || error.message.startsWith('Claude'))
                    ? error.message
                    : 'The Claude API could not finish this turn. Check the connection and the key in Settings.';
        } finally {
            this.repairPendingTools();
            try {
                await this.save();
            } catch {
                failure = 'The Claude API could not save this conversation.';
            }
            this.controller = null;
            endTurn(this.host, controller, failure);
        }
    }
    /* One request of a round, streamed into the thread under `ref` with a ref per block, and the tokens it spent logged even when it fails. */
    private async exchange(ref: string, signal: AbortSignal): Promise<AnthropicTurn> {
        // Before the idle clock starts: the first call connects to Ruimte's server.
        const tools = anthropicTools(await this.tools.definitions());
        const model = this.launch.selection.model;
        const key = this.service.apiKey;
        const idle = new AbortController();
        let cancelIdle = (): void => {};
        const touch = (): void => {
            cancelIdle();
            cancelIdle = this.idleTimer(STREAM_IDLE_MS, () => idle.abort());
        };
        let counted: AnthropicUsage | null = null;
        touch();
        try {
            const response = await this.service.request(`${ANTHROPIC_URL}/v1/messages`, {
                method: 'POST',
                redirect: 'error',
                headers: { ...anthropicHeaders(key), accept: 'text/event-stream' },
                signal: AbortSignal.any([signal, idle.signal]),
                body: JSON.stringify({
                    model,
                    max_tokens: this.service.maxOutputTokensFor(model),
                    stream: true,
                    system: [{ type: 'text', text: apiInstructions(this.launch), cache_control: { type: 'ephemeral' } }],
                    messages: this.withCacheMark(this.messages),
                    tools,
                    // The newer models think on their own; the older ones have to be asked, and say so in the model list.
                    ...(this.service.supportsAdaptiveThinking(model) ? { thinking: { type: 'adaptive', display: 'summarized' } } : {})
                })
            });
            if (!response.ok) {
                throw anthropicHttpError(response.status, response.status === 400 ? await this.messageOf(response, key) : undefined);
            }
            if (!response.body) {
                throw new Error('Anthropic returned an empty response.');
            }
            return await readAnthropicStream(touching(response.body, touch), {
                text: (index, text) => this.host.onEvent({ type: 'text.delta', ref: `${ref}-${index}`, text }),
                thinking: (index, text) => this.host.onEvent({ type: 'thinking.delta', ref: `${ref}-${index}`, text }),
                usage: (usage) => {
                    counted = usage;
                    this.host.onEvent({
                        type: 'usage',
                        // What the turn holds is the input and both cache kinds together, since Anthropic counts the input apart from them.
                        contextTokens: usage.input + usage.cacheRead + usage.cacheWrite,
                        contextWindow: this.service.catalog.contextWindowFor(this.launch.selection) ?? undefined
                    });
                }
            });
        } catch (error) {
            if (idle.signal.aborted && !signal.aborted) {
                throw new Error(`Anthropic sent nothing for ${STREAM_IDLE_MS / 60_000} minutes. Try again.`);
            }
            throw error;
        } finally {
            cancelIdle();
            // A failed or interrupted stream may already have spent tokens.
            if (counted !== null) {
                await this.service.logUsage({ model, session: this.sessionId, cwd: this.launch.cwd, ...(counted as AnthropicUsage) });
            }
        }
    }
    /* Anthropic wrote the message of a 400 and it says what to do; the body of any other status is never read. */
    private async messageOf(response: Response, key: string): Promise<string | undefined> {
        try {
            const body = z.object({ error: z.object({ message: z.string() }) }).parse(await response.json());
            return body.error.message.replaceAll(key, '[redacted]');
        } catch {
            return undefined;
        }
    }
    /*
     * The thread as the request carries it, with the cache mark on the last block of the last message: the mark
     * moves forward each call, so the whole thread up to the new message is read from the cache. It is put on a copy,
     * since a thread kept with marks would carry the old ones along.
     */
    private withCacheMark(messages: Message[]): Message[] {
        const copy = messages.map((message) => ({ ...message }));
        const last = copy.at(-1);
        if (last === undefined) {
            return copy;
        }
        const mark = { cache_control: { type: 'ephemeral' } };
        if (typeof last.content === 'string') {
            last.content = [{ type: 'text', text: last.content, ...mark }] as unknown as Block[];
        } else {
            const blocks = [...last.content];
            blocks[blocks.length - 1] = { ...blocks[blocks.length - 1]!, ...mark } as Block;
            last.content = blocks;
        }
        return copy;
    }
    /* A user turn is one message, so text for the next round joins the results of the last one instead of following them. */
    private addToUser(block: Block): void {
        const last = this.messages.at(-1);
        if (last?.role === 'user' && Array.isArray(last.content)) {
            last.content.push(block);
            return;
        }
        this.messages.push({ role: 'user', content: [block] });
    }
    /*
     * Runs the calls of one assistant turn and sends every result back in one user message, which the API requires.
     * A stop in the middle still sends them, the ones that ran and an interrupted result for the rest, so the thread
     * never holds a tool call without its result.
     */
    private async runTools(calls: AnthropicToolUse[], signal: AbortSignal): Promise<void> {
        const results: ToolResult[] = [];
        try {
            for (const call of calls) {
                // An input that was not an object is `null`, which the tools refuse like any other bad arguments.
                const { output, failed } = await this.tools.run(call.name, JSON.stringify(call.input), signal);
                results.push({ type: 'tool_result', tool_use_id: call.id, content: output, ...(failed ? { is_error: true } : {}) });
            }
        } finally {
            for (const call of calls.slice(results.length)) {
                results.push({ type: 'tool_result', tool_use_id: call.id, content: INTERRUPTED, is_error: true });
            }
            this.messages.push({ role: 'user', content: results });
            await this.save();
        }
    }
    /*
     * A crash or a stop can leave a tool call of the model without its result, and the API refuses a thread that has
     * one. Every call of an assistant turn gets a result in the message after it: the one it has, else an interrupted one.
     */
    private repairPendingTools(): void {
        const repaired: Message[] = [];
        for (let index = 0; index < this.messages.length; index++) {
            const message = this.messages[index]!;
            repaired.push(message);
            if (message.role !== 'assistant' || typeof message.content === 'string') {
                continue;
            }
            const calls = message.content.flatMap((block) => (block.type === 'tool_use' ? [block.id] : []));
            if (calls.length === 0) {
                continue;
            }
            const next = this.messages[index + 1];
            const have = next?.role === 'user' && Array.isArray(next.content) ? next.content : [];
            const results = have.filter((block): block is ToolResult => block.type === 'tool_result');
            const rest = next?.role === 'user' && Array.isArray(next.content) ? next.content.filter((block) => block.type !== 'tool_result') : [];
            const complete: Block[] = calls.map(
                (id) => results.find((result) => result.tool_use_id === id) ?? { type: 'tool_result', tool_use_id: id, content: INTERRUPTED, is_error: true }
            );
            repaired.push({ role: 'user', content: [...complete, ...rest] });
            if (next?.role === 'user') {
                index += 1;
            }
        }
        this.messages = repaired;
    }
    private save(): Promise<void> {
        return writeThread(this.path, this.messages, NAME);
    }
    compact(): void {
        throw new Error('The Claude API chat has no context compaction. Start a new chat.');
    }
    interrupt(): void {
        this.controller?.abort();
    }
    respondApproval(id: string, decision: ApprovalDecision): boolean {
        return this.tools.respondApproval(id, decision);
    }
    respondQuestion(id: string, answers: Record<string, string>): boolean {
        return this.tools.respondQuestion(id, answers);
    }
    declineRequest(id: string): boolean {
        return this.tools.declineRequest(id);
    }
    stop(): void {
        this.interrupt();
    }
    async dispose(): Promise<void> {
        this.interrupt();
        await this.work;
        await this.tools.close();
        this.opened = false;
        this.host.onEvent({ type: 'exit', exitCode: 0 });
    }
}
