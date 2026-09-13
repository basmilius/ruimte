import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { AgentInfo, AgentKind, AgentLaunch, ContextSource, EventMap, EventType, SessionInfo } from '@ruimte/contracts';
import type { AgentStore } from '../agents/agent-store.ts';
import { ApprovalStore, parsePermissionAsk, type ApprovalDecision } from '../agents/approvals.ts';
import { normalizeHook } from '../agents/hooks.ts';
import { freshCommand, resumeCommand, resumeOrFreshCommand, terminalCommand } from '../providers/launch.ts';
import { contextHint } from '../context/context-note.ts';
import { defaultShell, defaultShellArgs, type PtyAdapter } from '../pty/pty.ts';
import { Session } from './session.ts';
import type { SnapshotStore } from './snapshot-store.ts';

type SessionErrorCode = 'session-exists' | 'session-not-found' | 'session-exited' | 'spawn-failed' | 'agent-not-found' | 'agent-live' | 'agent-resuming';

/*
 * How long a typed resume has to produce a live agent before another one is allowed. A CLI that is
 * not installed prints "command not found" and reports nothing, and that session must stay retryable.
 */
const RESUME_GRACE_MS = 15_000;

/* What a fresh screen says before the shell has printed anything: the linked context, then whatever
   was left for this node while it did not exist. Undefined when there is nothing to say. */
const motdOf = (hint: string | null, notices: readonly string[]): string | undefined => {
    const lines = [...(hint === null ? [] : [hint]), ...notices];
    return lines.length === 0 ? undefined : lines.join('\n');
};

export class SessionError extends Error {
    readonly code: SessionErrorCode;

    constructor(code: SessionErrorCode, message: string) {
        super(message);
        this.name = 'SessionError';
        this.code = code;
    }
}

export type SessionEvent = { [E in EventType]: { event: E; payload: EventMap[E] } }[EventType];

export type SessionSink = (event: SessionEvent) => void;

interface CreateSessionOptions {
    sessionId: string;
    cols: number;
    rows: number;
    cwd?: string;
    shell?: string;
    command?: string;
    // An agent CLI to start instead of a plain command; the daemon builds the line it types.
    agent?: AgentLaunch;
    // Not on the wire; lets a test skip the login flag so the user's profile stays out of the output.
    args?: string[];
}

export interface SessionManagerOptions {
    adapter: PtyAdapter;
    snapshots?: SnapshotStore;
    agents?: AgentStore;
    env?: Record<string, string | undefined>;
    // Where the CLIs' hooks POST to; without it no hook variables reach the shell.
    hookUrl?: string;
    // Where an agent reads its linked context; the hook token doubles as its bearer.
    contextUrl?: string;
    // Put in front of PATH, so `ruimte-context` is there for every shell.
    binDir?: string;
    // What a session may read the moment it starts; a shell with links gets one line about the CLI above its first prompt.
    contextFor?: (sessionId: string) => ContextSource[];
    // The prompt an agent node was made with, taken once: the CLI starts on it instead of on an empty turn.
    firstPrompt?: (sessionId: string) => Promise<string | null>;
    // Messages another node left for this one before it started, taken once and shown above the first prompt.
    firstNotices?: (sessionId: string) => string[];
    // Lets a test move the clock the resume guard reads.
    now?: () => number;
    // Whether a permission request may be held for a client; off leaves every one to the CLI's own prompt.
    approvals?: boolean;
    // Lets a test shorten how long a request is held.
    approvalHoldMs?: number;
}

export type HookResult = 'applied' | 'ignored' | 'unknown-token';

/* `before-kill` comes while the tree is still whole, so a watcher can see what was in it; `changed` after it moved. */
export type ProcessChangePhase = 'before-kill' | 'changed';

export class SessionManager {
    private readonly adapter: PtyAdapter;
    private readonly snapshots: SnapshotStore | null;
    private readonly agents: AgentStore | null;
    private readonly env: Record<string, string | undefined>;
    private readonly sessions = new Map<string, Session>();
    private readonly sinks = new Map<string, SessionSink>();
    // The clients that said they never offer a permission request to a person, keyed like the sinks.
    private readonly withoutApprovals = new Set<string>();
    private readonly tokens = new Map<string, string>();
    // Ids whose kill is in flight: the exit that follows removes the session instead of parking it.
    private readonly killing = new Set<string>();
    // When a resume was typed into a session, until its agent reports in; the guard against typing a second one.
    private readonly resuming = new Map<string, number>();
    private readonly now: () => number;
    private readonly approvals: ApprovalStore | null;
    hookUrl: string | null;
    contextUrl: string | null;
    private readonly binDir: string | null;
    private readonly contextFor: (sessionId: string) => ContextSource[];
    private readonly firstPrompt: (sessionId: string) => Promise<string | null>;
    private readonly firstNotices: (sessionId: string) => string[];
    // Told when the process tree of a session is about to change or just did: the end of a turn, an exit, a kill.
    onProcessChange: ((sessionId: string, phase: ProcessChangePhase) => void) | null = null;
    // Whether the process monitor found the agent of a session gone while its status still says it runs.
    isAgentGone: (sessionId: string) => boolean = () => false;

    constructor(options: SessionManagerOptions) {
        this.adapter = options.adapter;
        this.snapshots = options.snapshots ?? null;
        this.agents = options.agents ?? null;
        this.env = options.env ?? process.env;
        this.hookUrl = options.hookUrl ?? null;
        this.contextUrl = options.contextUrl ?? null;
        this.binDir = options.binDir ?? null;
        this.contextFor = options.contextFor ?? (() => []);
        this.firstPrompt = options.firstPrompt ?? (() => Promise.resolve(null));
        this.firstNotices = options.firstNotices ?? (() => []);
        this.now = options.now ?? Date.now;
        this.approvals =
            options.approvals === false
                ? null
                : new ApprovalStore((sessionId, approvals) => {
                      for (const sink of this.sinks.values()) {
                          sink({ event: 'session.approvals', payload: { sessionId, approvals } });
                      }
                  }, options.approvalHoldMs);
    }

    /* The session a hook or context token belongs to. */
    sessionIdForToken(token: string): string | null {
        return this.tokens.get(token) ?? null;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        this.sinks.set(clientId, sink);
        return () => {
            if (this.sinks.get(clientId) === sink) {
                this.sinks.delete(clientId);
                this.withoutApprovals.delete(clientId);
            }
        };
    }

    /*
     * A client saying whether it offers permission requests to a person at all. Saying nothing means
     * it does, which is what every client written before the switch existed meant, and the answer is
     * this socket's alone: a second client that wants them is still asked.
     */
    setApprovalPreference(clientId: string, enabled: boolean): void {
        if (enabled) {
            this.withoutApprovals.delete(clientId);
        } else {
            this.withoutApprovals.add(clientId);
        }
    }

    /* Whether anybody attached would show a permission request. The question `holdApproval` asks. */
    wantsApprovals(): boolean {
        return [...this.sinks.keys()].some((clientId) => !this.withoutApprovals.has(clientId));
    }

    async create(options: CreateSessionOptions): Promise<SessionInfo> {
        const existing = this.sessions.get(options.sessionId);
        if (existing && !existing.exited) {
            throw new SessionError('session-exists', `Session ${options.sessionId} already exists`);
        }

        let restoredScreen: string | undefined;
        let restoredAgent: AgentInfo | undefined;
        if (existing) {
            // The previous shell of this id ended on its own; its last screen is worth as much as a disk snapshot.
            restoredScreen = await existing.serializeScreen();
            restoredAgent = existing.agent ?? undefined;
            this.remove(existing);
        } else {
            restoredScreen = (await this.snapshots?.read(options.sessionId)) ?? undefined;
            restoredAgent = (await this.agents?.read(options.sessionId)) ?? undefined;
        }

        const shell = options.shell ?? defaultShell(this.env);
        const session = this.spawn({
            id: options.sessionId,
            shell,
            args: options.args ?? defaultShellArgs(shell),
            cwd: options.cwd ?? this.env.HOME ?? homedir(),
            cols: options.cols,
            rows: options.rows,
            command: options.command ?? (await this.startLine(options.sessionId, options.agent, restoredAgent !== undefined)),
            restoredScreen,
            restoredAgent,
            launch: options.agent
        });
        this.sessions.set(session.id, session);
        this.tokens.set(session.hookToken, session.id);
        this.broadcastListChanged();
        return this.info(session);
    }

    /* A hook POST from a CLI inside one of the shells; the token says which one. */
    async applyHook(kind: AgentKind, token: string, body: unknown): Promise<HookResult> {
        const sessionId = this.tokens.get(token);
        const session = sessionId === undefined ? undefined : this.sessions.get(sessionId);
        if (!session) {
            return 'unknown-token';
        }
        const outcome = normalizeHook(body);
        if (!outcome) {
            return 'ignored';
        }
        const agent: AgentInfo | null =
            outcome.status === null
                ? null
                : {
                      kind,
                      agentSessionId: outcome.agentSessionId,
                      transcriptPath: outcome.transcriptPath ?? session.agent?.transcriptPath ?? null,
                      status: outcome.status,
                      live: true,
                      updatedAt: Date.now()
                  };
        if (agent !== null) {
            // The CLI is up and speaking for itself, so the resume it answers to is done.
            this.resuming.delete(session.id);
        }
        await this.setAgent(session, agent);
        if (agent === null || agent.status === 'idle' || agent.status === 'error') {
            this.onProcessChange?.(session.id, 'changed');
        }
        return 'applied';
    }

    /*
     * Holds a permission hook open while a person decides, and answers with what they chose. Null is
     * the daemon staying out of it, which is what happens with the feature off, with nobody who wants
     * to be asked, and when the hold runs out: in all three the CLI's own prompt is what asks, exactly
     * as without Ruimte. Never hold for a client that is not there or has said it will not ask, or a
     * request would sit here for its whole life with nobody able to answer it.
     */
    holdApproval(token: string, body: unknown, signal: AbortSignal): Promise<ApprovalDecision | null> {
        const sessionId = this.tokens.get(token);
        if (!this.approvals || sessionId === undefined || !this.wantsApprovals()) {
            return Promise.resolve(null);
        }
        const ask = parsePermissionAsk(body);
        if (ask === null) {
            return Promise.resolve(null);
        }
        return this.approvals.hold({ sessionId, ask, signal });
    }

    /* A client's answer to a held request. False when it was already settled, here or in the CLI's prompt. */
    answerApproval(sessionId: string, requestId: string, choiceId: string): boolean {
        return this.approvals?.answer(sessionId, requestId, choiceId) ?? false;
    }

    /* Types the CLI's resume command into the shell of a session whose agent is known but not running. */
    resumeAgent(sessionId: string): void {
        const session = this.require(sessionId);
        if (session.exited) {
            throw new SessionError('session-exited', `Session ${sessionId} has ended`);
        }
        if (!session.agent) {
            throw new SessionError('agent-not-found', `Session ${sessionId} has no agent to resume`);
        }
        // A CLI that died without a SessionEnd still reads as live; the process monitor is what knows better.
        if (session.agent.live && !this.isAgentGone(sessionId)) {
            throw new SessionError('agent-live', `The agent in ${sessionId} is still running`);
        }
        const typedAt = this.resuming.get(sessionId);
        if (typedAt !== undefined && this.now() - typedAt < RESUME_GRACE_MS) {
            throw new SessionError('agent-resuming', `A resume for ${sessionId} was typed already and its agent has not reported back yet`);
        }
        session.write(`${this.resumeLine(session, session.agent)}\n`);
        this.resuming.set(sessionId, this.now());
    }

    get(sessionId: string): Session | undefined {
        return this.sessions.get(sessionId);
    }

    list(): SessionInfo[] {
        return [...this.sessions.values()].map((session) => this.info(session));
    }

    async attach(sessionId: string, clientId: string, cols: number, rows: number): Promise<{ screen: string; cols: number; rows: number; exited: boolean }> {
        const session = this.require(sessionId);
        const screen = await session.attach(clientId, cols, rows);
        this.broadcastListChanged();
        return { screen, cols: session.cols, rows: session.rows, exited: session.exited };
    }

    detach(sessionId: string, clientId: string): void {
        const session = this.require(sessionId);
        if (!session.isAttached(clientId)) {
            return;
        }
        session.detach(clientId);
        this.broadcastListChanged();
    }

    detachAll(clientId: string): void {
        let changed = false;
        for (const session of this.sessions.values()) {
            if (session.isAttached(clientId)) {
                session.detach(clientId);
                changed = true;
            }
        }
        if (changed) {
            this.broadcastListChanged();
        }
    }

    write(sessionId: string, data: string): void {
        const session = this.require(sessionId);
        if (session.exited) {
            throw new SessionError('session-exited', `Session ${sessionId} has ended`);
        }
        session.write(data);
    }

    resize(sessionId: string, cols: number, rows: number): void {
        this.require(sessionId).resize(cols, rows);
    }

    // Every attached client repaints from the screen the daemon owns, the same way it does after a resync.
    async clear(sessionId: string): Promise<void> {
        const session = this.require(sessionId);
        const screen = await session.clear();
        for (const clientId of session.attachedClients()) {
            this.emit(clientId, { event: 'session.resync', payload: { sessionId, screen } });
        }
    }

    async kill(sessionId: string): Promise<void> {
        const session = this.require(sessionId);
        await this.snapshots?.delete(sessionId);
        await this.agents?.delete(sessionId);
        if (session.exited) {
            this.remove(session);
            this.broadcastListChanged();
            return;
        }
        this.onProcessChange?.(sessionId, 'before-kill');
        this.killing.add(sessionId);
        session.kill();
    }

    async snapshotAll(): Promise<Array<{ sessionId: string; screen: string }>> {
        const result: Array<{ sessionId: string; screen: string }> = [];
        for (const session of this.sessions.values()) {
            result.push({ sessionId: session.id, screen: await session.serializeScreen() });
        }
        return result;
    }

    // Ends every shell without touching the snapshots; used when the daemon itself goes down.
    killAll(): void {
        for (const session of this.sessions.values()) {
            if (!session.exited) {
                session.kill();
            }
        }
    }

    /*
     * The one line a fresh shell gets for its agent. Nothing is typed when the daemon remembers an
     * agent for this id: the client answers a non-live agent on attach with `agent.resume`, and a
     * launch line here would land in the input box of the CLI that line had just started. A resume
     * the node itself asked for is the caller's memory and not evidence, so the shell keeps the
     * fresh launch behind it.
     */
    private async startLine(sessionId: string, launch: AgentLaunch | undefined, restored: boolean): Promise<string | undefined> {
        if (!launch || restored) {
            return undefined;
        }
        if (launch.resume) {
            return resumeOrFreshCommand(launch, launch.resume);
        }
        // Taken only here: a prompt that is not put on a line is a prompt nobody would ever see.
        return terminalCommand(launch, (await this.firstPrompt(sessionId)) ?? undefined);
    }

    /*
     * What a resume types. A recorded session id is no proof that the conversation is still there:
     * Claude Code writes a transcript only once a CLI has had a prompt, so one that was started and
     * never used leaves an id that cannot be resumed, and a transcript can be deleted or moved. The
     * transcript file is the evidence; without it the CLI answers "No conversation found" and the
     * node is left with a bare shell. A kind whose hooks name no transcript at all has no evidence
     * either way, so there the shell decides, with the fresh launch behind a `||`.
     */
    private resumeLine(session: Session, agent: AgentInfo): string {
        // A person who started another CLI by hand in this shell is resumed as that CLI, not as the node's.
        const launch: AgentLaunch = session.launch?.kind === agent.kind ? session.launch : { kind: agent.kind };
        if (agent.transcriptPath === null) {
            return resumeOrFreshCommand(launch, agent.agentSessionId);
        }
        if (existsSync(agent.transcriptPath)) {
            return resumeCommand(agent.kind, agent.agentSessionId);
        }
        return freshCommand(launch);
    }

    private spawn(options: {
        id: string;
        shell: string;
        args: string[];
        cwd: string;
        cols: number;
        rows: number;
        command?: string;
        restoredScreen?: string;
        restoredAgent?: AgentInfo;
        launch?: AgentLaunch;
    }): Session {
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(this.env)) {
            if (value !== undefined) {
                env[key] = value;
            }
        }
        env.TERM = 'xterm-256color';
        env.COLORTERM = 'truecolor';
        env.RUIMTE_SESSION_ID = options.id;
        const hookToken = randomBytes(24).toString('base64url');
        if (this.hookUrl) {
            env.RUIMTE_HOOK_URL = this.hookUrl;
            env.RUIMTE_HOOK_TOKEN = hookToken;
        }
        if (this.contextUrl) {
            env.RUIMTE_CONTEXT_URL = this.contextUrl;
        }
        if (this.binDir) {
            env.PATH = env.PATH ? `${this.binDir}:${env.PATH}` : this.binDir;
        }

        let session: Session;
        try {
            session = new Session({
                ...options,
                env,
                hookToken,
                motd: motdOf(contextHint(this.contextFor(options.id)), this.firstNotices(options.id)),
                adapter: this.adapter,
                deliver: (clientId, data) => this.emit(clientId, { event: 'session.output', payload: { sessionId: options.id, data } }),
                onExit: (exitCode) => this.handleExit(options.id, exitCode)
            });
        } catch (e) {
            throw new SessionError('spawn-failed', e instanceof Error ? e.message : `Could not start ${options.shell}`);
        }
        return session;
    }

    private handleExit(sessionId: string, exitCode: number): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }
        // The shell is gone and every hook that was waiting in it with it, so nothing is left to answer.
        this.approvals?.dropSession(sessionId);
        for (const clientId of session.attachedClients()) {
            this.emit(clientId, { event: 'session.exit', payload: { sessionId, exitCode } });
        }
        if (this.killing.delete(sessionId)) {
            this.remove(session);
        } else if (session.agent?.live) {
            // The CLI never said goodbye, so it went down with the shell; its session may still resume.
            void this.setAgent(session, { ...session.agent, status: 'exited', live: false, updatedAt: Date.now() });
        }
        this.broadcastListChanged();
        this.onProcessChange?.(sessionId, 'changed');
    }

    private async setAgent(session: Session, agent: AgentInfo | null): Promise<void> {
        session.agent = agent;
        for (const sink of this.sinks.values()) {
            sink({ event: 'session.status', payload: { sessionId: session.id, agent } });
        }
        try {
            if (agent) {
                await this.agents?.write(session.id, agent);
            } else {
                await this.agents?.delete(session.id);
            }
        } catch (e) {
            console.error(`Agent record for ${session.id} failed`, e);
        }
    }

    private remove(session: Session): void {
        this.sessions.delete(session.id);
        this.resuming.delete(session.id);
        this.tokens.delete(session.hookToken);
        this.approvals?.dropSession(session.id);
        session.dispose();
    }

    private require(sessionId: string): Session {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new SessionError('session-not-found', `No session ${sessionId}`);
        }
        return session;
    }

    private info(session: Session): SessionInfo {
        return {
            sessionId: session.id,
            cwd: session.cwd,
            pid: session.pid,
            cols: session.cols,
            rows: session.rows,
            createdAt: session.createdAt,
            attached: session.attachedCount,
            exited: session.exited,
            ...(session.exitCode !== null ? { exitCode: session.exitCode } : {}),
            agent: session.agent,
            approvals: this.approvals?.forSession(session.id) ?? []
        };
    }

    private emit(clientId: string, event: SessionEvent): void {
        this.sinks.get(clientId)?.(event);
    }

    private broadcastListChanged(): void {
        for (const sink of this.sinks.values()) {
            sink({ event: 'session.list-changed', payload: {} });
        }
    }
}
