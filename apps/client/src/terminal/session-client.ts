import type { AgentLaunch, SessionAttachResult, SessionInfo } from '@ruimte/contracts';
import type { SessionSink } from '../state/sessions';
import { HandlerTable } from '../transport/handler-table';
import { MountedRegistry, type MountedEntry } from '../transport/mounted-registry';
import { isConnectionError, TransportError, type Transport, type TransportStatus } from '../transport/transport';

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

interface Mounted extends OpenOptions, MountedEntry {
    cols: number;
    rows: number;
}

/*
 * Recreates and reattaches mounted sessions after a lost socket or daemon restart, then supplies a
 * fresh screen. The injected transport is permanently bound to one machine.
 */
export class SessionClient {
    private readonly transport: Transport;
    private readonly sink: SessionSink;
    private readonly mounted = new MountedRegistry<Mounted>();
    private readonly opens = new Map<string, OpenOptions>();
    // Cold resumes already typed this page life; a CLI that is not installed must not be retyped on every attach.
    private readonly resumed = new Set<string>();
    // The nodes whose command the daemon holds, which a change in its list may have let go of.
    private readonly held = new Set<string>();
    private readonly outputHandlers = new HandlerTable<string>();
    private readonly exitHandlers = new HandlerTable<number>();
    private readonly screenHandlers = new HandlerTable<Pick<SessionAttachResult, 'screen'>>();
    private readonly sizeHandlers = new HandlerTable<Pick<SessionAttachResult, 'cols' | 'rows'>>();
    private readonly unsubscribe: Array<() => void> = [];

    constructor(transport: Transport, sink: SessionSink) {
        this.transport = transport;
        this.sink = sink;
        this.unsubscribe.push(
            transport.on('session.output', ({ sessionId, data }) => this.outputHandlers.fanOut(sessionId, data)),
            // The daemon dropped output for a slow socket and sent the screen it owns instead; repaint from it.
            transport.on('session.resync', ({ sessionId, screen }) => this.screenHandlers.fanOut(sessionId, { screen })),
            // The client at work elsewhere moved the PTY to its own grid.
            transport.on('session.size', ({ sessionId, cols, rows }) => this.sizeHandlers.fanOut(sessionId, { cols, rows })),
            transport.on('session.exit', ({ sessionId, exitCode }) => {
                this.sink.setExited(sessionId, exitCode);
                this.exitHandlers.fanOut(sessionId, exitCode);
            }),
            transport.on('session.status', ({ sessionId, agent }) => this.sink.setAgent(sessionId, agent)),
            // Another client said yes to a held command; this one only learns it from the list.
            transport.on('session.list-changed', () => {
                if (this.held.size > 0) {
                    void this.refreshHeld();
                }
            }),
            transport.subscribeStatus((status) => this.onStatus(status))
        );
        this.declineApprovals();
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
            this.setHeld(nodeId, info.heldCommand);
        } catch (e) {
            // The shell of a previous mount (or a previous tab) is still running; that is the whole point.
            if (!(e instanceof TransportError && e.code === 'session-exists')) {
                throw e;
            }
        }
    }

    /**
     * On mount a node registers, creates if needed, and attaches. Answers null when the transport is
     * not connected; the session stays registered and `onScreen` fires once the reconnect has attached it.
     */
    async open(nodeId: string, options: OpenOptions, cols: number, rows: number): Promise<SessionAttachResult | null> {
        this.mounted.set(nodeId, { ...options, cols, rows, attached: false });
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

    /*
     * Answers with the screen as soon as the daemon does: it streams from that moment, and output
     * written before the screen would be wiped by it. What the list says about the session follows.
     */
    attach(nodeId: string, cols: number, rows: number): Promise<SessionAttachResult> {
        return this.attachWith(nodeId, cols, rows, () => this.listSessions());
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
        this.held.delete(nodeId);
        this.sink.forget(nodeId);
        await this.transport.request('session.kill', { sessionId: nodeId });
    }

    /*
     * A person saying yes to the command the daemon holds for this node. Not an action in the catalog,
     * which voice and agents reach too: only a click on the question may approve a command.
     */
    async runHeld(nodeId: string): Promise<void> {
        await this.transport.request('session.runHeld', { sessionId: nodeId });
        this.setHeld(nodeId, undefined);
    }

    async resumeAgent(nodeId: string): Promise<void> {
        try {
            await this.transport.request('agent.resume', { sessionId: nodeId });
        } catch {
            // Nothing to resume, or the shell is gone; the status stays as the daemon reported it.
        }
    }

    onOutput(nodeId: string, handler: OutputHandler): () => void {
        return this.outputHandlers.listen(nodeId, handler);
    }

    onExit(nodeId: string, handler: ExitHandler): () => void {
        return this.exitHandlers.listen(nodeId, handler);
    }

    /* Fires after a reconnect re-attached the session; the screen replaces everything on the node. */
    onScreen(nodeId: string, handler: ScreenHandler): () => void {
        return this.screenHandlers.listen(nodeId, handler);
    }

    onSize(nodeId: string, handler: (size: Pick<SessionAttachResult, 'cols' | 'rows'>) => void): () => void {
        return this.sizeHandlers.listen(nodeId, handler);
    }

    isMounted(nodeId: string): boolean {
        return this.mounted.has(nodeId);
    }

    /* Lets go of the machine, which is not the same as ending its sessions. They keep running; the
       daemon only stops streaming their output to a socket this client no longer reads. */
    dispose(): void {
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe.length = 0;
        for (const nodeId of [...this.mounted.keys()]) {
            void this.detach(nodeId);
        }
    }

    /*
     * A terminal's permission request is answered in its CLI's own prompt. A daemon from before that
     * holds one for every socket that does not say no, which keeps the CLI's prompt from showing.
     */
    private declineApprovals(): void {
        void this.transport.request('agent.setApprovals', { enabled: false }).catch(() => undefined);
    }

    private onStatus(status: TransportStatus): void {
        if (status === 'open') {
            this.declineApprovals();
            let listed: Promise<SessionInfo[] | null> | null = null;
            // One list for the whole pass, asked for once the first attach has answered.
            const sessions = (): Promise<SessionInfo[] | null> => (listed ??= this.listSessions());
            void this.mounted.reattachAll((nodeId, entry) => this.reattach(nodeId, entry, sessions));
            return;
        }
        this.mounted.detachAll((nodeId) => this.sink.setAttached(nodeId, false));
    }

    private async reattach(nodeId: string, entry: Mounted, sessions: () => Promise<SessionInfo[] | null>): Promise<void> {
        await this.ensure(nodeId, { cwd: entry.cwd, command: entry.command, agent: entry.agent }, entry.cols, entry.rows);
        // The node may have left the canvas while the create was on the wire.
        if (!this.mounted.has(nodeId)) {
            return;
        }
        const result = await this.attachWith(nodeId, entry.cols, entry.rows, sessions);
        this.sizeHandlers.fanOut(nodeId, { cols: result.cols, rows: result.rows });
        this.screenHandlers.fanOut(nodeId, result);
    }

    private async attachWith(nodeId: string, cols: number, rows: number, sessions: () => Promise<SessionInfo[] | null>): Promise<SessionAttachResult> {
        // Registered before the request, so a socket that drops mid-flight still brings this node back.
        this.mounted.set(nodeId, { ...this.opens.get(nodeId), cols, rows, attached: false });
        try {
            const result = await this.transport.request('session.attach', { sessionId: nodeId, cols, rows });
            const entry = this.mounted.get(nodeId);
            if (entry) {
                entry.attached = true;
                this.sink.setAttached(nodeId, true);
            }
            void this.settle(nodeId, result, sessions);
            return result;
        } catch (e) {
            if (!isConnectionError(e)) {
                this.mounted.delete(nodeId);
            }
            throw e;
        }
    }

    // The attach reply says only that the shell ended; the exit code and the agent are on the list entry.
    private async settle(nodeId: string, result: SessionAttachResult, sessions: () => Promise<SessionInfo[] | null>): Promise<void> {
        const info = (await sessions())?.find((session) => session.sessionId === nodeId) ?? null;
        if (result.exited) {
            this.sink.setExited(nodeId, info?.exitCode ?? 0);
        }
        this.sink.setAgent(nodeId, info?.agent ?? null);
        this.setHeld(nodeId, info?.heldCommand);
        if (info?.agent && !info.agent.live && !result.exited && !this.resumed.has(nodeId)) {
            // The daemon came back with a record of the agent that ran here; pick it up where it left off.
            this.resumed.add(nodeId);
            void this.resumeAgent(nodeId);
        }
    }

    private setHeld(nodeId: string, command: string | undefined): void {
        if (command === undefined) {
            this.held.delete(nodeId);
        } else {
            this.held.add(nodeId);
        }
        this.sink.setHeldCommand(nodeId, command);
    }

    private async refreshHeld(): Promise<void> {
        const sessions = await this.listSessions();
        if (sessions === null) {
            return;
        }
        for (const nodeId of [...this.held]) {
            this.setHeld(nodeId, sessions.find((session) => session.sessionId === nodeId)?.heldCommand);
        }
    }

    private async listSessions(): Promise<SessionInfo[] | null> {
        try {
            return (await this.transport.request('session.list', {})).sessions;
        } catch {
            return null;
        }
    }
}
