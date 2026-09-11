import type { AgentLaunch, SessionAttachResult, SessionInfo } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID } from '../state/endpoints';
import type { SessionSink } from '../state/sessions';
import { TransportError, type Transport, type TransportStatus } from '../transport/transport';

type OutputHandler = (data: string) => void;
type ExitHandler = (exitCode: number) => void;
type ScreenHandler = (result: Pick<SessionAttachResult, 'screen'>) => void;

interface OpenOptions {
    cwd?: string;
    /* Typed into the shell as its first line when the session is created. */
    command?: string;
    /* An agent CLI to start instead; the daemon builds the line it types. */
    agent?: AgentLaunch;
}

interface Mounted extends OpenOptions {
    cols: number;
    rows: number;
    /* False between a lost connection (or a failed attach) and the next successful attach. */
    attached: boolean;
    /* The daemon this session runs on; a socket that comes back pointed at another one is not its socket. */
    endpointId: string;
}

const isConnectionError = (e: unknown): boolean => e instanceof TransportError && (e.code === 'not-connected' || e.code === 'disconnected');

/**
 * One daemon session per node id, on top of the transport.
 *
 * A node calls `ensure` and `attach` when it mounts and `detach` when it unmounts. Everything
 * in between (a lost socket, the daemon restarting) is this class's problem: every session that
 * is still mounted is created again and re-attached when the transport comes back, and the fresh
 * screen is handed to `onScreen` subscribers so the node can repaint from scratch.
 */
export class SessionClient {
    private readonly transport: Transport;
    private readonly sink: SessionSink;
    private readonly endpointId: () => string;
    private readonly mounted = new Map<string, Mounted>();
    private readonly opens = new Map<string, OpenOptions>();
    // Cold resumes already typed this page life; a CLI that is not installed must not be retyped on every attach.
    private readonly resumed = new Set<string>();
    private readonly outputHandlers = new Map<string, Set<OutputHandler>>();
    private readonly exitHandlers = new Map<string, Set<ExitHandler>>();
    private readonly screenHandlers = new Map<string, Set<ScreenHandler>>();
    private readonly unsubscribe: Array<() => void> = [];

    constructor(transport: Transport, sink: SessionSink, endpointId: () => string = () => LOCAL_ENDPOINT_ID) {
        this.transport = transport;
        this.sink = sink;
        this.endpointId = endpointId;
        this.unsubscribe.push(
            transport.on('session.output', ({ sessionId, data }) => this.fanOut(this.outputHandlers, sessionId, data)),
            // The daemon dropped output for a slow socket and sent the screen it owns instead; repaint from it.
            transport.on('session.resync', ({ sessionId, screen }) => this.fanOut(this.screenHandlers, sessionId, { screen })),
            transport.on('session.exit', ({ sessionId, exitCode }) => {
                this.sink.setExited(sessionId, exitCode);
                this.fanOut(this.exitHandlers, sessionId, exitCode);
            }),
            transport.on('session.status', ({ sessionId, agent }) => this.sink.setAgent(sessionId, agent)),
            transport.subscribeStatus((status) => this.onStatus(status))
        );
    }

    async ensure(nodeId: string, options: OpenOptions, cols: number, rows: number): Promise<void> {
        this.opens.set(nodeId, options);
        try {
            const info = await this.transport.request('session.create', {
                sessionId: nodeId,
                cwd: options.cwd,
                command: options.command,
                agent: options.agent,
                cols,
                rows
            });
            this.sink.setExited(nodeId, undefined);
            this.sink.setAgent(nodeId, info.agent ?? null);
        } catch (e) {
            // The shell of a previous mount (or a previous tab) is still running; that is the whole point.
            if (!(e instanceof TransportError && e.code === 'session-exists')) {
                throw e;
            }
        }
    }

    /**
     * What a node does on mount: register, create if needed, attach. Answers null when the
     * transport is not connected; the session stays registered and `onScreen` fires once the
     * reconnect has attached it.
     */
    async open(nodeId: string, options: OpenOptions, cols: number, rows: number): Promise<SessionAttachResult | null> {
        this.mounted.set(nodeId, { ...options, cols, rows, attached: false, endpointId: this.endpointId() });
        try {
            await this.ensure(nodeId, options, cols, rows);
            return await this.attach(nodeId, cols, rows);
        } catch (e) {
            if (isConnectionError(e)) {
                return null;
            }
            throw e;
        }
    }

    async attach(nodeId: string, cols: number, rows: number): Promise<SessionAttachResult> {
        // Registered before the request, so a socket that drops mid-flight still brings this node back.
        this.mounted.set(nodeId, { ...this.opens.get(nodeId), cols, rows, attached: false, endpointId: this.endpointId() });
        try {
            const result = await this.transport.request('session.attach', { sessionId: nodeId, cols, rows });
            const entry = this.mounted.get(nodeId);
            if (entry) {
                entry.attached = true;
                this.sink.setAttached(nodeId, true);
            }
            const info = await this.infoOf(nodeId);
            if (result.exited) {
                this.sink.setExited(nodeId, info?.exitCode ?? 0);
            }
            this.sink.setAgent(nodeId, info?.agent ?? null);
            if (info?.agent && !info.agent.live && !result.exited && !this.resumed.has(nodeId)) {
                // The daemon came back with a record of the agent that ran here; pick it up where it left off.
                this.resumed.add(nodeId);
                void this.resumeAgent(nodeId);
            }
            return result;
        } catch (e) {
            if (!isConnectionError(e)) {
                this.mounted.delete(nodeId);
            }
            throw e;
        }
    }

    async detach(nodeId: string): Promise<void> {
        const entry = this.mounted.get(nodeId);
        this.mounted.delete(nodeId);
        this.sink.setAttached(nodeId, false);
        if (!entry?.attached) {
            return;
        }
        try {
            await this.transport.request('session.detach', { sessionId: nodeId });
        } catch {
            // The socket closing detaches every session server-side anyway.
        }
    }

    write(nodeId: string, data: string): void {
        void this.transport.request('session.write', { sessionId: nodeId, data }).catch(() => undefined);
    }

    /* The daemon owns the screen, so it clears it and pushes the fresh one to every attached client. */
    clear(nodeId: string): void {
        void this.transport.request('session.clear', { sessionId: nodeId }).catch(() => undefined);
    }

    resize(nodeId: string, cols: number, rows: number): void {
        const entry = this.mounted.get(nodeId);
        if (entry) {
            entry.cols = cols;
            entry.rows = rows;
        }
        void this.transport.request('session.resize', { sessionId: nodeId, cols, rows }).catch(() => undefined);
    }

    async kill(nodeId: string): Promise<void> {
        this.mounted.delete(nodeId);
        this.opens.delete(nodeId);
        this.resumed.delete(nodeId);
        this.sink.forget(nodeId);
        await this.transport.request('session.kill', { sessionId: nodeId });
    }

    async resumeAgent(nodeId: string): Promise<void> {
        try {
            await this.transport.request('agent.resume', { sessionId: nodeId });
        } catch {
            // Nothing to resume, or the shell is gone; the status stays as the daemon reported it.
        }
    }

    onOutput(nodeId: string, handler: OutputHandler): () => void {
        return this.listen(this.outputHandlers, nodeId, handler);
    }

    onExit(nodeId: string, handler: ExitHandler): () => void {
        return this.listen(this.exitHandlers, nodeId, handler);
    }

    /* Fires after a reconnect re-attached the session; the screen replaces everything on the node. */
    onScreen(nodeId: string, handler: ScreenHandler): () => void {
        return this.listen(this.screenHandlers, nodeId, handler);
    }

    isMounted(nodeId: string): boolean {
        return this.mounted.has(nodeId);
    }

    dispose(): void {
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe.length = 0;
    }

    private listen<T>(table: Map<string, Set<(value: T) => void>>, nodeId: string, handler: (value: T) => void): () => void {
        let handlers = table.get(nodeId);
        if (!handlers) {
            handlers = new Set();
            table.set(nodeId, handlers);
        }
        handlers.add(handler);
        return () => {
            handlers.delete(handler);
            if (handlers.size === 0) {
                table.delete(nodeId);
            }
        };
    }

    private fanOut<T>(table: Map<string, Set<(value: T) => void>>, nodeId: string, value: T): void {
        const handlers = table.get(nodeId);
        if (!handlers) {
            return;
        }
        for (const handler of [...handlers]) {
            handler(value);
        }
    }

    private onStatus(status: TransportStatus): void {
        if (status === 'open') {
            void this.reattachAll();
            return;
        }
        for (const [nodeId, entry] of this.mounted) {
            entry.attached = false;
            this.sink.setAttached(nodeId, false);
        }
    }

    private async reattachAll(): Promise<void> {
        for (const [nodeId, entry] of [...this.mounted]) {
            if (entry.attached) {
                continue;
            }
            // The socket that just opened belongs to another daemon; this session is not there, and creating it would be a second shell.
            if (entry.endpointId !== this.endpointId()) {
                this.mounted.delete(nodeId);
                continue;
            }
            try {
                await this.ensure(nodeId, { cwd: entry.cwd, command: entry.command }, entry.cols, entry.rows);
                if (!this.mounted.has(nodeId)) {
                    continue;
                }
                const result = await this.attach(nodeId, entry.cols, entry.rows);
                this.fanOut(this.screenHandlers, nodeId, result);
            } catch {
                // A socket that dropped again will trigger the next round; anything else surfaces on the next mount.
            }
        }
    }

    // The attach reply says only that the shell ended; the exit code and the agent are on the list entry.
    private async infoOf(nodeId: string): Promise<SessionInfo | null> {
        try {
            const { sessions } = await this.transport.request('session.list', {});
            return sessions.find((session) => session.sessionId === nodeId) ?? null;
        } catch {
            return null;
        }
    }
}
