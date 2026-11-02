import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { RuntimeMode } from '@ruimte/contracts';
import type { ApprovalDecision, BackendHost, BackendLaunch, ChatBackend, TurnInput } from '@adecore/agents/chat';
import { NANOGPT_URL, nanoHttpError, type NanoGptService } from '../providers/nanogpt-service.ts';
import { ApiTools, CONTINUE_MESSAGE, INTERRUPTED, apiInstructions, endTurn, readThread, writeThread, type ToolRounds } from './api-chat.ts';
import { executeNanoTool, nanoEffectiveMode } from './nanogpt-tools.ts';
import { readNanoStream, type NanoAnswer, type NanoUsage } from './nanogpt-stream.ts';

const MessageSchema = z.object({
    role: z.enum(['user', 'assistant', 'tool']),
    content: z.string(),
    reasoning_content: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z
        .array(
            z.object({
                id: z.string(),
                type: z.literal('function'),
                function: z.object({ name: z.string(), arguments: z.string() })
            })
        )
        .optional()
});
type Message = z.infer<typeof MessageSchema>;

const NAME = 'NanoGPT';

/* A chat on NanoGPT's subscription API, its thread kept beside the key as `<session id>.json`. */
export class NanoGptBackend implements ChatBackend {
    private opened = false;
    private controller: AbortController | null = null;
    private work: Promise<void> | null = null;
    private messages: Message[] = [];
    private readonly sessionId: string;
    private readonly path: string;
    private readonly launch: BackendLaunch;
    private readonly host: BackendHost;
    private readonly service: NanoGptService;
    private readonly tools: ApiTools;
    private readonly limitsOverride: ToolRounds | undefined;
    readonly pid = null;
    private readonly mode: RuntimeMode;

    constructor(launch: BackendLaunch, host: BackendHost, service: NanoGptService, executeTool = executeNanoTool, limits?: ToolRounds) {
        this.launch = launch;
        this.host = host;
        this.service = service;
        this.limitsOverride = limits;
        // A change of mode restarts the backend, so the mode it started with holds for its whole life.
        this.mode = nanoEffectiveMode(launch.runtimeMode);
        this.tools = new ApiTools({
            launch,
            host,
            mode: this.mode,
            approval: 'NanoGPT requests access to this project.',
            home: service.directory,
            executeTool
        });
        this.sessionId = launch.resume ?? randomUUID();
        if (!z.string().uuid().safeParse(this.sessionId).success) {
            throw new Error('Invalid NanoGPT session id.');
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
            throw new Error('Add a NanoGPT API key in Settings → Providers.');
        }
        if (!this.service.catalog.resolveModel(this.launch.selection.model)) {
            throw new Error('Refresh the NanoGPT subscription models in Settings.');
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
            throw new Error('NanoGPT is not ready for a new turn.');
        }
        if (input.attachments.length || input.skills.length || input.mentions.length) {
            this.host.onEvent({
                type: 'turn.done',
                state: 'error',
                costUsd: 0,
                error: 'NanoGPT currently accepts text and project tools. Attachments and skill chips are unavailable.'
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
            this.messages.push({ role: 'user', content: [input.preamble, input.text].filter(Boolean).join('\n\n') });
            await this.save();
            // Read as the run starts, so a change in Settings holds from the next message.
            const limits = this.limitsOverride ?? this.service.runLimits();
            const rounds = limits.roundsPerRun * limits.runs;
            for (let round = 0; round < rounds; round++) {
                controller.signal.throwIfAborted();
                if (round > 0 && round % limits.roundsPerRun === 0) {
                    this.host.onEvent({ type: 'note', level: 'info', text: `Continuing after ${round} tool rounds.` });
                    this.messages.push({ role: 'user', content: CONTINUE_MESSAGE });
                    await this.save();
                }
                const answer = await this.exchange(randomUUID(), controller.signal);
                this.messages.push(answer);
                await this.save();
                if (!answer.tool_calls?.length) {
                    return;
                }
                for (const call of answer.tool_calls) {
                    const { output } = await this.tools.run(call.function.name, call.function.arguments, controller.signal);
                    this.messages.push({ role: 'tool', tool_call_id: call.id, content: output });
                    await this.save();
                }
            }
            throw new Error(`NanoGPT reached ${rounds} tool rounds. Send another message to continue.`);
        } catch (error) {
            // Never forward fetch errors or raw remote bodies: these can contain credentials.
            failure =
                error instanceof Error && error.message.startsWith('NanoGPT')
                    ? error.message
                    : 'NanoGPT could not finish this turn. Check the connection and subscription settings.';
        } finally {
            this.repairPendingTools();
            try {
                await this.save();
            } catch {
                failure = 'NanoGPT could not save this conversation.';
            }
            this.controller = null;
            endTurn(this.host, controller, failure);
        }
    }

    /* One request of a round, streamed into the thread under `ref`, with the tokens it spent logged before a stop can end the turn. */
    private async exchange(ref: string, signal: AbortSignal): Promise<NanoAnswer> {
        if (!this.service.apiKey) {
            throw new Error('NanoGPT was disconnected in Settings.');
        }
        const response = await this.service.request(`${NANOGPT_URL}/chat/completions`, {
            method: 'POST',
            redirect: 'error',
            headers: { Authorization: `Bearer ${this.service.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
            body: JSON.stringify({
                model: this.launch.selection.model,
                stream: true,
                // The API sends the counts of a streamed request only when asked, and both the context meter and the usage page read them.
                stream_options: { include_usage: true },
                messages: [{ role: 'system', content: apiInstructions(this.launch) }, ...this.messages],
                ...(this.service.supportsTools(this.launch.selection.model)
                    ? { tools: (await this.tools.definitions()).map((tool) => ({ type: 'function', function: tool })) }
                    : {})
            })
        });
        if (!response.ok) {
            throw nanoHttpError(response.status);
        }
        if (!response.body) {
            throw new Error('NanoGPT returned an empty response.');
        }
        let counted: NanoUsage | null = null;
        const answer = await readNanoStream(
            response.body,
            (text) => this.host.onEvent({ type: 'text.delta', ref, text }),
            (text) => this.host.onEvent({ type: 'thinking.delta', ref: `${ref}-thinking`, text }),
            (usage) => {
                counted = usage;
                this.host.onEvent({
                    type: 'usage',
                    contextTokens: usage.prompt,
                    contextWindow: this.service.catalog.contextWindowFor(this.launch.selection) ?? undefined
                });
            }
        );
        if (counted !== null) {
            await this.service.logUsage({ model: this.launch.selection.model, session: this.sessionId, cwd: this.launch.cwd, ...(counted as NanoUsage) });
        }
        signal.throwIfAborted();
        if (answer.content) {
            this.host.onEvent({ type: 'text.done', ref, text: answer.content });
        }
        if (answer.reasoning_content) {
            this.host.onEvent({ type: 'thinking.done', ref: `${ref}-thinking`, text: answer.reasoning_content });
        }
        return answer;
    }

    /* A crash may leave assistant calls without results; the ones that came stay and the rest read as interrupted. */
    private repairPendingTools(): void {
        const repaired: Message[] = [];
        for (let index = 0; index < this.messages.length; index++) {
            const message = this.messages[index]!;
            repaired.push(message);
            if (!message.tool_calls?.length) {
                continue;
            }
            const results: Message[] = [];
            while (this.messages[index + 1]?.role === 'tool') {
                results.push(this.messages[++index]!);
            }
            for (const call of message.tool_calls) {
                repaired.push(results.find((result) => result.tool_call_id === call.id) ?? { role: 'tool', tool_call_id: call.id, content: INTERRUPTED });
            }
        }
        this.messages = repaired;
    }

    private save(): Promise<void> {
        return writeThread(this.path, this.messages, NAME);
    }

    compact(): void {
        throw new Error('NanoGPT context compaction is unavailable. Start a new chat.');
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
