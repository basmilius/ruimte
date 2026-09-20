import { accessSync, constants } from 'node:fs';
import { attachmentImageMime, type ChatSkill } from '@ruimte/contracts';
import { chatPrompt, contextPrompt } from '../context/context-note.ts';
import { codexServiceTier, codexThreadOptions } from '../providers/codex.ts';
import type { ApprovalDecision, BackendEvent, BackendHost, BackendLaunch, ChatBackend, TurnInput } from './backend.ts';
import { CodexProtocol } from './codex-protocol.ts';
import { attachmentNote } from './input.ts';
import { CodexTransport, type CodexFrame } from './codex-transport.ts';
import { errorText } from '../error-text.ts';

// After stdin closed, an app-server that is still around is not going to say more.
const EXIT_GRACE_MS = 3000;

const CLIENT_INFO = { name: 'ruimte', title: 'Ruimte', version: '0.1.0' };

const textInput = (text: string) => [{ type: 'text', text, text_elements: [] }];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/* The enabled skills of a `skills/list` answer; Codex reports one entry per folder it was asked about. */
export const parseSkillsList = (result: unknown): ChatSkill[] => {
    const data = isRecord(result) && Array.isArray(result.data) ? result.data : [];
    const skills = new Map<string, ChatSkill>();
    for (const entry of data) {
        for (const skill of isRecord(entry) && Array.isArray(entry.skills) ? entry.skills : []) {
            if (!isRecord(skill) || typeof skill.name !== 'string' || skill.enabled === false || skills.has(skill.name)) {
                continue;
            }
            skills.set(skill.name, {
                name: skill.name,
                description: typeof skill.description === 'string' ? skill.description : '',
                source: skill.pluginId ? 'plugin' : skill.scope === 'repo' ? 'project' : 'user'
            });
        }
    }
    return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name));
};

/*
 * One `codex app-server` process on JSON-RPC over stdio. `start` handshakes (initialize, then
 * thread/start or thread/resume) before the first turn goes out, so every later request knows the
 * thread id. The note about `ruimte-context` goes in as the thread's developer instructions, which
 * Codex keeps with the thread. The runtime modes are an approval policy plus a sandbox.
 */
export class CodexBackend implements ChatBackend {
    private readonly launch: BackendLaunch;
    private readonly host: BackendHost;
    private readonly protocol: CodexProtocol;
    private transport: CodexTransport | null = null;
    private threadId = '';
    private exitTimer: ReturnType<typeof setTimeout> | null = null;
    /*
     * Codex 0.154 ignores developer instructions on `thread/resume` (measured), so a thread started
     * before anything was linked would never hear of its links; the first prompt of a resumed process says so instead.
     */
    private contextPending: string | null = null;
    private imageInputSupported: boolean | null = null;

    constructor(launch: BackendLaunch, host: BackendHost) {
        this.launch = launch;
        this.host = host;
        this.protocol = new CodexProtocol(launch.generation);
        this.threadId = launch.resume ?? '';
    }

    get running(): boolean {
        return this.transport !== null;
    }

    get pid(): number | null {
        return this.transport?.pid ?? null;
    }

    async start(): Promise<void> {
        if (this.transport) {
            return;
        }
        const transport = new CodexTransport({
            command: this.launch.command,
            cwd: this.launch.cwd,
            env: this.launch.env,
            ...(this.launch.spawn ? { spawn: this.launch.spawn } : {}),
            onFrame: (frame) => this.handleFrame(transport, frame),
            onExit: (exitCode) => this.handleExit(transport, exitCode)
        });
        this.transport = transport;
        await transport.request('initialize', { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true, requestAttestation: false } });
        transport.notify('initialized', {});
        const tier = codexServiceTier(this.launch.selection);
        const params = {
            cwd: this.launch.cwd,
            model: this.launch.selection.model,
            ...(tier === null ? {} : { serviceTier: tier }),
            ...codexThreadOptions(this.launch.runtimeMode)
        };
        const developerInstructions = chatPrompt({ sources: this.launch.context, depth: this.launch.depth, standalone: this.launch.standalone });
        let result: unknown;
        if (this.launch.resume) {
            try {
                result = await transport.request('thread/resume', { threadId: this.launch.resume, excludeTurns: true, ...params });
                this.contextPending = contextPrompt(this.launch.context);
            } catch (error) {
                // The thread is gone from Codex's store; a fresh one keeps the chat usable.
                this.emit({ type: 'note', level: 'warning', text: `Codex could not resume its thread (${errorText(error)}). Started a new one.` });
                result = await transport.request('thread/start', { ...params, developerInstructions });
            }
        } else {
            result = await transport.request('thread/start', { ...params, developerInstructions });
        }
        this.imageInputSupported = await this.readImageSupport(transport);
        for (const event of this.protocol.threadReady(result)) {
            if (event.type === 'session' && event.agentSessionId) {
                this.threadId = event.agentSessionId;
            }
            this.emit(event);
        }
    }

    sendTurn(input: TurnInput): void {
        const images = input.attachments.filter((attachment) => attachmentImageMime(attachment) !== null);
        if (images.length > 0 && this.imageInputSupported === false) {
            throw new Error(`${this.launch.selection.model} does not support image input. Choose a model that accepts images.`);
        }
        for (const attachment of images) {
            try {
                accessSync(attachment.path, constants.R_OK);
            } catch {
                throw new Error(`Could not read attached image "${attachment.name}". Attach it again and retry.`);
            }
        }
        const parts: string[] = [];
        if (this.contextPending !== null) {
            parts.push(`${this.contextPending}\n\n`);
            this.contextPending = null;
        }
        if (input.preamble !== null) {
            parts.push(`${input.preamble}\n\n`);
        }
        parts.push(input.text);
        const note = attachmentNote(input.attachments);
        if (note !== '') {
            parts.push(`\n\n${note}`);
        }
        const effort = this.launch.selection.options.effort;
        const tier = codexServiceTier(this.launch.selection);
        this.request('turn/start', {
            threadId: this.threadId,
            input: [...textInput(parts.join('')), ...images.map((attachment) => ({ type: 'localImage', path: attachment.path }))],
            model: this.launch.selection.model,
            ...(typeof effort === 'string' ? { effort } : {}),
            ...(tier === null ? {} : { serviceTier: tier })
        });
    }

    private async readImageSupport(transport: CodexTransport): Promise<boolean | null> {
        let cursor: string | null = null;
        const seen = new Set<string>();
        try {
            do {
                const result = await transport.request('model/list', { includeHidden: true, ...(cursor === null ? {} : { cursor }) });
                if (!isRecord(result) || !Array.isArray(result.data)) {
                    return null;
                }
                const model = result.data.find((entry) => isRecord(entry) && entry.model === this.launch.selection.model);
                if (isRecord(model)) {
                    return Array.isArray(model.inputModalities) ? model.inputModalities.includes('image') : null;
                }
                cursor = typeof result.nextCursor === 'string' ? result.nextCursor : null;
                if (cursor !== null) {
                    if (seen.has(cursor)) {
                        return null;
                    }
                    seen.add(cursor);
                }
            } while (cursor !== null);
        } catch {
            // Older app-servers may not report modalities; their turn response remains authoritative.
        }
        return null;
    }

    compact(): void {
        this.request('thread/compact/start', { threadId: this.threadId });
    }

    /* Not a turn: a name Codex refuses is not something the person has to hear about. */
    setTitle(title: string): void {
        if (!this.transport || this.threadId === '') {
            return;
        }
        void this.transport.request('thread/name/set', { threadId: this.threadId, name: title }).catch(() => undefined);
    }

    /* Codex keeps its own skill index, so the running app-server is the authority on what it will run. */
    async listSkills(): Promise<ChatSkill[]> {
        const transport = this.transport;
        if (!transport) {
            return [];
        }
        return parseSkillsList(await transport.request('skills/list', { cwds: [this.launch.cwd] }));
    }

    listThreadItems(params: { threadId: string; cursor?: string; limit: number; sortDirection: 'asc' | 'desc' }): Promise<unknown> {
        const transport = this.transport;
        if (!transport) {
            return Promise.reject(new Error('thread/items/list failed: Codex is not running'));
        }
        return transport.request('thread/items/list', params);
    }

    interrupt(): void {
        const turnId = this.protocol.turnId;
        if (!this.transport || !turnId) {
            return;
        }
        void this.transport.request('turn/interrupt', { threadId: this.threadId, turnId }).catch(() => {
            // A turn that already ended has nothing to interrupt.
        });
    }

    respondApproval(requestId: string, decision: ApprovalDecision): boolean {
        if (!this.transport) {
            return false;
        }
        const answer = this.protocol.approvalDecision(requestId, decision);
        if (!answer) {
            return false;
        }
        this.transport.respond(answer.rpcId, answer.result);
        return true;
    }

    respondQuestion(requestId: string, answers: Record<string, string>): boolean {
        if (!this.transport) {
            return false;
        }
        const answer = this.protocol.questionAnswer(requestId, answers);
        if (!answer) {
            return false;
        }
        if (answer.kind === 'respond') {
            this.transport.respond(answer.rpcId, answer.result);
            return true;
        }
        const turnId = this.protocol.turnId;
        if (!turnId) {
            // Codex refuses a steer without the turn it is meant for, and there is none left to join.
            return false;
        }
        this.request('turn/steer', { threadId: this.threadId, expectedTurnId: turnId, input: textInput(answer.text) });
        return true;
    }

    /* Codex asks its async question once and waits; forgetting it locally is all a dismissal is. */
    dismissRequest(requestId: string): boolean {
        return this.protocol.dismissQuestion(requestId);
    }

    stop(): void {
        const transport = this.transport;
        if (!transport || this.exitTimer !== null) {
            return;
        }
        transport.end();
        this.exitTimer = setTimeout(() => {
            this.exitTimer = null;
            transport.kill('SIGTERM');
        }, EXIT_GRACE_MS);
    }

    dispose(): void {
        if (this.exitTimer !== null) {
            clearTimeout(this.exitTimer);
            this.exitTimer = null;
        }
        this.transport?.kill('SIGKILL');
        this.transport = null;
    }

    /* A request whose failure the person has to hear about, since it is the turn that cannot go on. */
    private request(method: string, params: unknown): void {
        const transport = this.transport;
        if (!transport) {
            this.emit({ type: 'failed', message: `${method} failed: Codex is not running` });
            return;
        }
        void transport.request(method, params).catch((error: unknown) => {
            if (this.transport === transport) {
                this.emit({ type: 'failed', message: errorText(error) });
            }
        });
    }

    private handleFrame(transport: CodexTransport, frame: CodexFrame): void {
        if (this.transport !== transport) {
            return;
        }
        const events = this.protocol.handle(frame);
        // A server request the protocol did not take still needs an answer, or Codex waits forever.
        if (frame.id !== undefined && events.length === 0 && (typeof frame.id === 'number' || typeof frame.id === 'string')) {
            transport.respondError(frame.id, -32601, `Ruimte does not handle ${String(frame.method)}`);
        }
        for (const event of events) {
            this.emit(event);
        }
    }

    private handleExit(transport: CodexTransport, exitCode: number | null): void {
        if (this.transport !== transport) {
            return;
        }
        if (this.exitTimer !== null) {
            clearTimeout(this.exitTimer);
            this.exitTimer = null;
        }
        this.transport = null;
        this.protocol.forgetPending();
        this.emit({ type: 'exit', exitCode });
    }

    private emit(event: BackendEvent): void {
        this.host.onEvent(event);
    }
}
