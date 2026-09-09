import { homedir } from 'node:os';
import type { EventMap, EventType, SessionInfo } from '@ruimte/contracts';
import { defaultShell, defaultShellArgs, type PtyAdapter } from '../pty/pty.ts';
import { Session } from './session.ts';
import type { SnapshotStore } from './snapshot-store.ts';

export type SessionErrorCode = 'session-exists' | 'session-not-found' | 'session-exited' | 'spawn-failed';

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

export interface CreateSessionOptions {
    sessionId: string;
    cols: number;
    rows: number;
    cwd?: string;
    shell?: string;
    // Not on the wire; lets a test skip the login flag so the user's profile stays out of the output.
    args?: string[];
}

export interface SessionManagerOptions {
    adapter: PtyAdapter;
    snapshots?: SnapshotStore;
    env?: Record<string, string | undefined>;
}

export class SessionManager {
    private readonly adapter: PtyAdapter;
    private readonly snapshots: SnapshotStore | null;
    private readonly env: Record<string, string | undefined>;
    private readonly sessions = new Map<string, Session>();
    private readonly sinks = new Map<string, SessionSink>();
    // Ids whose kill is in flight: the exit that follows removes the session instead of parking it.
    private readonly killing = new Set<string>();

    constructor(options: SessionManagerOptions) {
        this.adapter = options.adapter;
        this.snapshots = options.snapshots ?? null;
        this.env = options.env ?? process.env;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        this.sinks.set(clientId, sink);
        return () => {
            if (this.sinks.get(clientId) === sink) {
                this.sinks.delete(clientId);
            }
        };
    }

    async create(options: CreateSessionOptions): Promise<SessionInfo> {
        const existing = this.sessions.get(options.sessionId);
        if (existing && !existing.exited) {
            throw new SessionError('session-exists', `Session ${options.sessionId} already exists`);
        }

        let restoredScreen: string | undefined;
        if (existing) {
            // The previous shell of this id ended on its own; its last screen is worth as much as a disk snapshot.
            restoredScreen = await existing.serializeScreen();
            this.remove(existing);
        } else if (this.snapshots) {
            restoredScreen = (await this.snapshots.read(options.sessionId)) ?? undefined;
        }

        const shell = options.shell ?? defaultShell(this.env);
        const session = this.spawn({
            id: options.sessionId,
            shell,
            args: options.args ?? defaultShellArgs(shell),
            cwd: options.cwd ?? this.env.HOME ?? homedir(),
            cols: options.cols,
            rows: options.rows,
            restoredScreen
        });
        this.sessions.set(session.id, session);
        this.broadcastListChanged();
        return this.info(session);
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

    async kill(sessionId: string): Promise<void> {
        const session = this.require(sessionId);
        if (this.snapshots) {
            await this.snapshots.delete(sessionId);
        }
        if (session.exited) {
            this.remove(session);
            this.broadcastListChanged();
            return;
        }
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

    private spawn(options: { id: string; shell: string; args: string[]; cwd: string; cols: number; rows: number; restoredScreen?: string }): Session {
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(this.env)) {
            if (value !== undefined) {
                env[key] = value;
            }
        }
        env.TERM = 'xterm-256color';
        env.COLORTERM = 'truecolor';
        env.RUIMTE_SESSION_ID = options.id;

        try {
            return new Session({
                ...options,
                env,
                adapter: this.adapter,
                deliver: (clientId, data) => this.emit(clientId, { event: 'session.output', payload: { sessionId: options.id, data } }),
                onExit: (exitCode) => this.handleExit(options.id, exitCode)
            });
        } catch (e) {
            throw new SessionError('spawn-failed', e instanceof Error ? e.message : `Could not start ${options.shell}`);
        }
    }

    private handleExit(sessionId: string, exitCode: number): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }
        for (const clientId of session.attachedClients()) {
            this.emit(clientId, { event: 'session.exit', payload: { sessionId, exitCode } });
        }
        if (this.killing.delete(sessionId)) {
            this.remove(session);
        }
        this.broadcastListChanged();
    }

    private remove(session: Session): void {
        this.sessions.delete(session.id);
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
            ...(session.exitCode !== null ? { exitCode: session.exitCode } : {})
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
