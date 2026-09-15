import type { ChatSkill } from '@ruimte/contracts';
import { chatPrompt } from '../context/context-note.ts';
import { codexServiceTier, codexThreadOptions } from '../providers/codex.ts';
import type { ApprovalDecision, BackendEvent, BackendHost, BackendLaunch, ChatBackend, TurnInput } from './backend.ts';
import { CodexProtocol } from './codex-protocol.ts';
import { attachmentNote } from './input.ts';
import { CodexTransport, type CodexFrame } from './codex-transport.ts';

// After stdin closed, an app-server that is still around is not going to say more.
const EXIT_GRACE_MS = 3000;

const CLIENT_INFO = { name: 'ruimte', title: 'Ruimte', version: '0.1.0' };

const textInput = (text: string) => [{ type: 'text', text, text_elements: [] }];

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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
 * thread id. Codex has no system prompt flag, so linked context is announced in front of the first
 * prompt instead. The runtime modes are an approval policy plus a sandbox.
 */
export class CodexBackend implements ChatBackend {
    private readonly launch: BackendLaunch;
    private readonly host: BackendHost;
    private readonly protocol: CodexProtocol;
    private transport: CodexTransport | null = null;
    private threadId = '';
    private exitTimer: ReturnType<typeof setTimeout> | null = null;
    // The note about ruimte-context is told once per process, in front of the first prompt it takes.
    private hintPending = true;

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
        let result: unknown;
        if (this.launch.resume) {
            try {
                result = await transport.request('thread/resume', { threadId: this.launch.resume, excludeTurns: true, ...params });
            } catch (error) {
                // The thread is gone from Codex's store; a fresh one keeps the chat usable.
                this.emit({ type: 'note', level: 'warning', text: `Codex could not resume its thread (${reason(error)}). Started a new one.` });
                result = await transport.request('thread/start', params);
            }
        } else {
            result = await transport.request('thread/start', params);
        }
        for (const event of this.protocol.threadReady(result)) {
            if (event.type === 'session' && event.agentSessionId) {
                this.threadId = event.agentSessionId;
            }
            this.emit(event);
        }
    }

    sendTurn(input: TurnInput): void {
        const parts: string[] = [];
        if (this.hintPending) {
            this.hintPending = false;
            parts.push(`${chatPrompt(this.launch.hasContext)}\n\n`);
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
            input: textInput(parts.join('')),
            model: this.launch.selection.model,
            ...(typeof effort === 'string' ? { effort } : {}),
            ...(tier === null ? {} : { serviceTier: tier })
        });
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
        } else {
            this.request('turn/steer', { threadId: this.threadId, input: textInput(answer.text) });
        }
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
                this.emit({ type: 'failed', message: reason(error) });
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
