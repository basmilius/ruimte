import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { AgentInfo, AgentKind, AgentLaunch, ContextSource, EventMap, EventType, RuntimeMode, SessionInfo } from '@ruimte/contracts';
import type { AgentStore } from '../agents/agent-store.ts';
import { ApprovalStore, parsePermissionAsk, type ApprovalDecision } from '../agents/approvals.ts';
import { modeOfHook, normalizeHook } from '../agents/hooks.ts';
import { DEFAULT_RUNTIME_MODE, freshCommand, launchedMode, resumeCommand, resumeOrFreshCommand, terminalCommand } from '../providers/launch.ts';
import { narrowerMode } from '../canvas/mode.ts';
import { contextHint, verbsNote } from '../context/context-note.ts';
import { defaultShell, defaultShellArgs, type PtyAdapter } from '../pty/pty.ts';
import { Session } from './session.ts';
import type { SessionSnapshot, SnapshotStore } from './snapshot-store.ts';
import { errorText } from '../error-text.ts';
import { CodedError } from '../coded-error.ts';
import { ClientSinks } from '../client-sinks.ts';

type SessionErrorCode = 'session-exists' | 'session-not-found' | 'session-exited' | 'spawn-failed' | 'agent-not-found' | 'agent-live' | 'agent-resuming';

/*
 * How long a typed resume has to produce a live agent before another one is allowed. A CLI that is
 * not installed prints "command not found" and reports nothing, and that session must stay retryable.
 */
const RESUME_GRACE_MS = 15_000;

/* What a fresh screen says before the shell has printed anything: the linked context, then whatever
   was left for this node while it did not exist. */
const motdOf = (hint: string | null, notices: readonly string[]): string | undefined => {
    const lines = [...(hint === null ? [] : [hint]), ...notices];
    return lines.length === 0 ? undefined : lines.join('\n');
};

export class SessionError extends CodedError<SessionErrorCode> {}

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
    // How deep a session sits in a chain of agents, which decides what the note about the verbs offers its CLI.
    depthOf?: (sessionId: string) => number;
    // Whether computer use is on for this machine, which is when the note names the `computer` noun.
    computerUse?: () => boolean;
    // Lets a test move the clock the resume guard reads.
    now?: () => number;
    // Whether a permission request may be held for a client; off leaves every one to the CLI's own prompt.
    approvals?: boolean;
    // Lets a test shorten how long a request is held.
    approvalHoldMs?: number;
    // Where Claude Code's own name for a session is read from the transcript its hooks point at.
    claudeTitles?: { forTranscript(path: string): Promise<string | null> };
    // Where the Codex TUI's own name for a thread is read, by the thread id its hooks carry.
    codexTitles?: { forThread(threadId: string): Promise<string | null> };
    // Lets a test shorten the wait before a session without a name looks again.
    titleRetryMs?: number;
    // Which commands a person on this machine let a shell type. Without it every command is typed.
    commands?: CommandGate;
    // The widest mode the agent of this node may start in, whatever the node says; null for no limit.
    modeCeiling?: (sessionId: string) => RuntimeMode | null;
    // Refuses a directory this node may not start in, asked right before every spawn.
    checkCwd?: (sessionId: string, cwd: string) => Promise<void>;
}

export interface CommandGate {
    approved(sessionId: string, command: string): boolean;
    /* Writes down that a person let this node type this command. */
    approve(sessionId: string, command: string): Promise<void>;
}

// How often a hook of a turn in flight may look for a name the session does not have yet.
const TITLE_READ_INTERVAL_MS = 5_000;
// Codex names a thread up to 90 seconds after it started, often after a short turn already ended and
// no hook is coming until the next prompt; a session without a name looks again this often, this many times.
const TITLE_RETRY_MS = 15_000;
const TITLE_RETRIES = 6;

export type HookResult = 'applied' | 'ignored' | 'unknown-token';

/* `before-kill` comes while the tree is still whole, so a watcher can see what was in it; `changed` after it moved. */
export type ProcessChangePhase = 'before-kill' | 'changed';

export class SessionManager {
    private readonly adapter: PtyAdapter;
    private readonly snapshots: SnapshotStore | null;
    private readonly agents: AgentStore | null;
    private readonly env: Record<string, string | undefined>;
    private readonly sessions = new Map<string, Session>();
    private readonly creating = new Map<string, Promise<SessionInfo>>();
    private readonly sinks = new ClientSinks((clientId) => this.withoutApprovals.delete(clientId));
    // The clients that said they never offer a permission request to a person, keyed like the sinks.
    private readonly withoutApprovals = new Set<string>();
    private readonly tokens = new Map<string, string>();
    // Ids whose kill is in flight: the exit that follows removes the session instead of parking it.
    private readonly killing = new Set<string>();
    // A snapshot pass that took a screen before its node was deleted must not write the file back.
    private readonly deleted = new WeakSet<Session>();
    // When a resume was typed into a session, until its agent reports in; the guard against typing a second one.
    private readonly resuming = new Map<string, number>();
    private readonly now: () => number;
    private readonly approvals: ApprovalStore | null;
    private readonly claudeTitles: SessionManagerOptions['claudeTitles'] | null;
    private readonly codexTitles: SessionManagerOptions['codexTitles'] | null;
    private readonly titleRetryMs: number;
    private readonly titleRetries = new Map<string, { timer: ReturnType<typeof setTimeout> | null; count: number }>();
    // When each session last looked for its name, so the tool hooks of a busy turn do not all read.
    private readonly titleReadAt = new Map<string, number>();
    hookUrl: string | null;
    contextUrl: string | null;
    private readonly binDir: string | null;
    private readonly contextFor: (sessionId: string) => ContextSource[];
    private readonly firstPrompt: (sessionId: string) => Promise<string | null>;
    private readonly firstNotices: (sessionId: string) => string[];
    private readonly depthOf: (sessionId: string) => number;
    private readonly computerUse: () => boolean;
    private readonly commands: CommandGate | null;
    private readonly modeCeiling: (sessionId: string) => RuntimeMode | null;
    private readonly checkCwd: (sessionId: string, cwd: string) => Promise<void>;
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
        this.depthOf = options.depthOf ?? (() => 0);
        this.computerUse = options.computerUse ?? (() => false);
        this.now = options.now ?? Date.now;
        this.claudeTitles = options.claudeTitles ?? null;
        this.codexTitles = options.codexTitles ?? null;
        this.titleRetryMs = options.titleRetryMs ?? TITLE_RETRY_MS;
        this.commands = options.commands ?? null;
        this.modeCeiling = options.modeCeiling ?? (() => null);
        this.checkCwd = options.checkCwd ?? (() => Promise.resolve());
        this.approvals =
            options.approvals === false
                ? null
                : new ApprovalStore((sessionId, approvals) => {
                      this.broadcast({ event: 'session.approvals', payload: { sessionId, approvals } });
                  }, options.approvalHoldMs);
    }

    /* The session a hook or context token belongs to. */
    sessionIdForToken(token: string): string | null {
        return this.tokens.get(token) ?? null;
    }

    /* Whether a hook token belongs to a live session, which is what `applyHook` goes on to ask. */
    knows(token: string): boolean {
        const sessionId = this.tokens.get(token);
        return sessionId !== undefined && this.sessions.has(sessionId);
    }

    private readonly observers = new Set<SessionSink>();
    offlineApprovals: (() => Promise<boolean>) | null = null;

    observe(sink: SessionSink): () => void {
        this.observers.add(sink);
        return () => {
            this.observers.delete(sink);
        };
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
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
        return this.sinks.clientIds().some((clientId) => !this.withoutApprovals.has(clientId));
    }

    /*
     * One create per id at a time, and every caller shares its outcome. The daemon starts an agent
     * node the moment a verb writes it while a client with that view open mounts it just as fast,
     * and two creates that both pass the check below would spawn two shells, one of them holding
     * the prompt and lost from the map.
     */
    create(options: CreateSessionOptions): Promise<SessionInfo> {
        const inFlight = this.creating.get(options.sessionId);
        if (inFlight) {
            return inFlight;
        }
        const created = this.createNow(options).finally(() => this.creating.delete(options.sessionId));
        this.creating.set(options.sessionId, created);
        return created;
    }

    private async createNow(options: CreateSessionOptions): Promise<SessionInfo> {
        const existing = this.sessions.get(options.sessionId);
        if (existing && !existing.exited) {
            throw new SessionError('session-exists', `Session ${options.sessionId} already exists`);
        }
        const cwd = options.cwd ?? this.env.HOME ?? homedir();
        await this.checkCwd(options.sessionId, cwd);

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

        const launch = this.withinCeiling(options.sessionId, options.agent);
        const held = options.command && this.commands?.approved(options.sessionId, options.command) === false ? options.command : null;
        const shell = options.shell ?? defaultShell(this.env);
        const session = this.spawn({
            id: options.sessionId,
            shell,
            args: options.args ?? defaultShellArgs(shell),
            cwd,
            cols: options.cols,
            rows: options.rows,
            command: held === null ? (options.command ?? (await this.startLine(options.sessionId, launch, restoredAgent !== undefined))) : undefined,
            restoredScreen,
            restoredAgent,
            launch
        });
        session.heldCommand = held;
        this.sessions.set(session.id, session);
        this.tokens.set(session.hookToken, session.id);
        this.broadcastListChanged();
        return this.info(session);
    }

    /* The launch with its mode narrowed to what the node may have, which a project file cannot widen. */
    private withinCeiling(sessionId: string, launch: AgentLaunch | undefined): AgentLaunch | undefined {
        const ceiling = this.modeCeiling(sessionId);
        if (!launch || ceiling === null) {
            return launch;
        }
        return { ...launch, runtimeMode: narrowerMode(launch.runtimeMode ?? DEFAULT_RUNTIME_MODE, ceiling) };
    }

    /*
     * A person saying yes to the command a session holds: written down first, so the next start of
     * this node types it too, then typed. A second client that says yes as well finds nothing held.
     */
    async runHeld(sessionId: string): Promise<void> {
        const session = this.require(sessionId);
        if (session.exited) {
            throw new SessionError('session-exited', `Session ${sessionId} has ended`);
        }
        const command = session.heldCommand;
        if (command === null) {
            return;
        }
        session.heldCommand = null;
        try {
            await this.commands?.approve(sessionId, command);
        } catch (e) {
            session.heldCommand = command;
            throw e;
        }
        this.typeHeld(session, command);
    }

    /* A person's save approved this command for this node; a session holding exactly that one types it now. */
    runApproved(sessionId: string, command: string): void {
        const session = this.sessions.get(sessionId);
        if (session && !session.exited && session.heldCommand === command) {
            session.heldCommand = null;
            this.typeHeld(session, command);
        }
    }

    private typeHeld(session: Session, command: string): void {
        if (!session.exited) {
            session.write(`${command}\n`);
        }
        this.broadcastListChanged();
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
        // A name belongs to the conversation it was given in; a new one in the same shell starts without.
        const suggestedTitle = session.agent?.agentSessionId === outcome.agentSessionId ? session.agent.suggestedTitle : undefined;
        const agent: AgentInfo | null =
            outcome.status === null
                ? null
                : {
                      kind,
                      agentSessionId: outcome.agentSessionId,
                      transcriptPath: outcome.transcriptPath ?? session.agent?.transcriptPath ?? null,
                      ...(suggestedTitle !== undefined ? { suggestedTitle } : {}),
                      status: outcome.status,
                      live: true,
                      updatedAt: Date.now()
                  };
        if (agent !== null) {
            // The CLI is up and speaking for itself, so the resume it answers to is done.
            this.resuming.delete(session.id);
        }
        session.reportedMode = agent === null ? null : (modeOfHook(kind, outcome.permissionMode, launchedMode(session.launch)) ?? session.reportedMode);
        await this.setAgent(session, agent);
        if (agent !== null) {
            this.refreshTitle(session, agent);
        }
        if (agent === null || agent.status === 'idle' || agent.status === 'error') {
            /* Claude Code 2.1.270 leaves its hook open after a TUI answer. An idle or ended status
               proves the prompt is gone; `running` does not, because tools may run concurrently. */
            this.approvals?.dropSession(session.id);
            this.onProcessChange?.(session.id, 'changed');
        }
        return 'applied';
    }

    /*
     * Holds a permission hook open while a person decides, and answers with what they chose. Null is
     * the daemon staying out of it, which is what happens with the feature off, with nobody who wants
     * to be asked, and when the hold runs out: in all three the CLI's own prompt is what asks, exactly
     * as without Ruimte. An offline device may answer through a push, but only while its paired
     * key still has an active approval subscription.
     */
    holdApproval(token: string, body: unknown, signal: AbortSignal): Promise<ApprovalDecision | null> {
        const sessionId = this.tokens.get(token);
        if (!this.approvals || sessionId === undefined) {
            return Promise.resolve(null);
        }
        const ask = parsePermissionAsk(body);
        if (ask === null) {
            return Promise.resolve(null);
        }
        const hold = (): Promise<ApprovalDecision | null> => this.approvals!.hold({ sessionId, ask, signal });
        return this.wantsApprovals() ? hold() : (this.offlineApprovals?.() ?? Promise.resolve(false)).then((available) => (available ? hold() : null));
    }

    /* A client's answer to a held request. False when it was already settled, here or in the CLI's prompt. */
    answerApproval(sessionId: string, requestId: string, choiceId: string): boolean {
        if (this.approvals?.answer(sessionId, requestId, choiceId) !== true) {
            return false;
        }
        this.settleAfterApproval(sessionId);
        return true;
    }

    /*
     * Claude Code 2.1.270 emits no hook after an external approval until the tool finishes. Mark the
     * session running now unless another request still needs an answer; later hooks remain authoritative.
     */
    private settleAfterApproval(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        const agent = session?.agent;
        if (!session || !agent || agent.status !== 'needs-you' || this.approvals?.forSession(sessionId).length !== 0) {
            return;
        }
        void this.setAgent(session, { ...agent, status: 'running', updatedAt: Date.now() });
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

    async attach(sessionId: string, clientId: string, cols?: number, rows?: number): Promise<{ screen: string; cols: number; rows: number; exited: boolean }> {
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
        const session = this.require(sessionId);
        if (session.cols !== cols || session.rows !== rows) {
            session.resize(cols, rows);
            this.broadcastListChanged();
        }
    }

    // Every attached client repaints from the screen the daemon owns, the same way it does after a resync.
    async clear(sessionId: string): Promise<void> {
        const session = this.require(sessionId);
        await session.clear((clientId, screen) => this.emit(clientId, { event: 'session.resync', payload: { sessionId, screen } }));
    }

    async kill(sessionId: string): Promise<void> {
        // A node deleted while its session is still being made ends that session rather than missing it.
        await this.creating.get(sessionId)?.catch(() => undefined);
        const session = this.require(sessionId);
        this.deleted.add(session);
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

    /*
     * Ends the shell and keeps the session, listed as exited with its last screen, for a child whose
     * parent was stopped: removing it is a person's call, as deleting the node is.
     */
    async end(sessionId: string): Promise<void> {
        await this.creating.get(sessionId)?.catch(() => undefined);
        const session = this.sessions.get(sessionId);
        if (!session || session.exited) {
            return;
        }
        this.onProcessChange?.(sessionId, 'before-kill');
        session.kill();
    }

    /* The screens that changed since the last pass; a quiet session costs nothing. */
    async snapshotAll(): Promise<SessionSnapshot[]> {
        const result: SessionSnapshot[] = [];
        for (const session of [...this.sessions.values()]) {
            const screen = this.deleted.has(session) ? null : session.changedScreen();
            if (screen === null) {
                continue;
            }
            result.push({
                sessionId: session.id,
                screen: await screen,
                deleted: () => this.deleted.has(session),
                unsaved: () => session.markChanged()
            });
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

    // Restored shells resume after attach; typing here could land in the input of a CLI that is still alive.
    private async startLine(sessionId: string, launch: AgentLaunch | undefined, restored: boolean): Promise<string | undefined> {
        if (!launch || restored) {
            return undefined;
        }
        const note = verbsNote({ depth: this.depthOf(sessionId), computer: this.computerUse() });
        if (launch.resume) {
            return resumeOrFreshCommand(launch, launch.resume, note);
        }
        // Taken only here: a prompt that is not put on a line is a prompt nobody would ever see.
        return terminalCommand(launch, (await this.firstPrompt(sessionId)) ?? undefined, note);
    }

    /*
     * A recorded id may outlive its transcript. Resume only when the transcript exists; providers
     * that expose no path try resume with a fresh launch as the shell fallback.
     */
    private resumeLine(session: Session, agent: AgentInfo): string {
        // A person who started another CLI by hand in this shell is resumed as that CLI, not as the node's.
        const launch: AgentLaunch = session.launch?.kind === agent.kind ? session.launch : { kind: agent.kind };
        const note = verbsNote({ depth: this.depthOf(session.id), computer: this.computerUse() });
        if (agent.transcriptPath === null) {
            return resumeOrFreshCommand(launch, agent.agentSessionId, note);
        }
        if (existsSync(agent.transcriptPath)) {
            return resumeCommand(launch, agent.agentSessionId);
        }
        return freshCommand(launch, note);
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
        this.broadcast({ event: 'session.status', payload: { sessionId: session.id, agent } });
        try {
            if (agent) {
                await this.agents?.write(session.id, agent);
            } else {
                await this.agents?.delete(session.id);
            }
        } catch (e) {
            console.error(`Agent record for ${session.id} failed:`, errorText(e));
        }
    }

    /* How the CLI of this agent is asked for its own name, or null for a CLI that writes none down. */
    private titleReader(agent: AgentInfo): (() => Promise<string | null>) | null {
        const claude = this.claudeTitles;
        const codex = this.codexTitles;
        const path = agent.transcriptPath;
        const threadId = agent.agentSessionId;
        if (agent.kind === 'claude' && claude && path !== null) {
            return () => claude.forTranscript(path);
        }
        if (agent.kind === 'codex' && codex && threadId !== null) {
            return () => codex.forThread(threadId);
        }
        return null;
    }

    /*
     * Looks for the name the CLI wrote down. Not awaited by the hook, which the CLI waits on: the
     * first read of a long resumed transcript is not free. A turn that ends is always worth a look, a
     * hook in the middle of one only while there is no name yet and not too often. A look that finds
     * nothing tries again a few times, since the name may land after the last hook of a short turn.
     */
    private refreshTitle(session: Session, agent: AgentInfo, retry = false): void {
        const read = this.titleReader(agent);
        if (read === null) {
            return;
        }
        const now = this.now();
        const last = this.titleReadAt.get(session.id);
        if (!retry) {
            // A hook starts the retries over, so every prompt gets the whole window to be named in.
            const pending = this.titleRetries.get(session.id);
            if (pending) {
                pending.count = 0;
            }
            if (agent.status === 'running' && (agent.suggestedTitle !== undefined || (last !== undefined && now - last < TITLE_READ_INTERVAL_MS))) {
                return;
            }
        }
        this.titleReadAt.set(session.id, now);
        void read()
            .then((title) => {
                const current = session.agent;
                if (this.sessions.get(session.id) !== session || current === null || current.agentSessionId !== agent.agentSessionId) {
                    return;
                }
                if (title === null) {
                    if (current.suggestedTitle === undefined) {
                        this.retryTitle(session);
                    }
                    return;
                }
                this.titleRetries.delete(session.id);
                if (current.suggestedTitle === title) {
                    return;
                }
                return this.setAgent(session, { ...current, suggestedTitle: title });
            })
            .catch(() => undefined);
    }

    private retryTitle(session: Session): void {
        const pending = this.titleRetries.get(session.id) ?? { timer: null, count: 0 };
        this.titleRetries.set(session.id, pending);
        if (pending.timer !== null || pending.count >= TITLE_RETRIES) {
            return;
        }
        pending.count += 1;
        pending.timer = setTimeout(() => {
            pending.timer = null;
            const agent = session.agent;
            if (this.sessions.get(session.id) === session && agent !== null && agent.live && agent.suggestedTitle === undefined) {
                this.refreshTitle(session, agent, true);
            }
        }, this.titleRetryMs);
        pending.timer.unref?.();
    }

    private remove(session: Session): void {
        this.sessions.delete(session.id);
        this.resuming.delete(session.id);
        this.titleReadAt.delete(session.id);
        const retry = this.titleRetries.get(session.id);
        if (retry?.timer) {
            clearTimeout(retry.timer);
        }
        this.titleRetries.delete(session.id);
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
            approvals: this.approvals?.forSession(session.id) ?? [],
            ...(session.heldCommand !== null ? { heldCommand: session.heldCommand } : {})
        };
    }

    private emit(clientId: string, event: SessionEvent): void {
        this.sinks.to(clientId, event);
    }

    private broadcastListChanged(): void {
        this.broadcast({ event: 'session.list-changed', payload: {} });
    }

    /* Every client watching sessions, and the parts of the daemon that observe them beside. */
    private broadcast(event: SessionEvent): void {
        this.sinks.emit(event);
        for (const observer of this.observers) {
            observer(event);
        }
    }
}
