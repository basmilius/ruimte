import type { AgentLaunch, SessionAttachPayload, SessionAttachResult, SessionInfo } from '@ruimte/contracts';
import type { SessionSink } from '../state/sessions';
import { HandlerTable } from '../transport/handler-table';
import { MountedRegistry, type MountedEntry } from '@adecore/agents-react/mounted-registry';
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
    /* A session the daemon started for something else, such as a launch: attached to, never created. */
    follow?: boolean;
}

interface Mounted extends OpenOptions, MountedEntry {
    cols: number;
    rows: number;
}

interface Attachment {
    renderer: Mounted | null;
    followers: Set<symbol>;
    attached: boolean;
    pending: Set<Promise<SessionAttachResult>>;
    following: Promise<SessionAttachResult> | null;
}

/*
 * Recreates and reattaches mounted sessions after a lost socket or daemon restart, then supplies a
 * fresh screen. The injected transport is permanently bound to one machine.
 */
export class SessionClient {
    private readonly transport: Transport;
    private readonly sink: SessionSink;
    private readonly mounted = new MountedRegistry<Mounted>();
    private disposed = false;
    private readonly attachments = new Map<string, Attachment>();
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
            transport.on('session.output', ({ sessionId, data }) => {
                // A hidden follow can stream while a new renderer is still waiting for its initial snapshot.
                if (this.mounted.get(sessionId)?.attached !== false) {
                    this.outputHandlers.fanOut(sessionId, data);
                }
            }),
            // The daemon dropped output for a slow socket and sent the screen it owns instead; repaint from it.
            transport.on('session.resync', ({ sessionId, screen }) => {
                if (this.mounted.get(sessionId)?.attached !== false) {
                    this.screenHandlers.fanOut(sessionId, { screen });
                }
            }),
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
        if (options.follow === true) {
            return;
        }
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
            this.sink.setAccount(nodeId, info.account);
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
     * Null as well for a node that left before it was attached.
     */
    async open(nodeId: string, options: OpenOptions, cols: number, rows: number): Promise<SessionAttachResult | null> {
        if (this.disposed) {
            return null;
        }
        const registered: Mounted = { ...options, cols, rows, attached: false };
        const attachment = this.register(nodeId, registered);
        try {
            await this.ensure(nodeId, options, cols, rows);
            // The node may have left the canvas while the create was on the wire.
            if (!this.isCurrent(nodeId, registered, attachment)) {
                return null;
            }
            // A resize meanwhile updated the entry; the attach claims the PTY, so the grid of the mount would undo it.
            return await this.attach(nodeId, registered.cols, registered.rows);
        } catch (e) {
            if (isConnectionError(e)) {
                return null;
            }
            this.unregister(nodeId, registered, attachment);
            throw e;
        }
    }

    /*
     * Answers with the screen as soon as the daemon does: it streams from that moment, and output
     * written before the screen would be wiped by it. What the list says about the session follows.
     */
    attach(nodeId: string, cols: number, rows: number): Promise<SessionAttachResult | null> {
        return this.attachWith(nodeId, cols, rows, () => this.listSessions());
    }

    /* A preview shares the stream, never another snapshot that could consume a renderer's pending output. */
    async retain(nodeId: string): Promise<() => void> {
        if (this.disposed || this.transport.status !== 'open') {
            throw disconnected();
        }
        const attachment = this.attachment(nodeId);
        const holder = Symbol();
        attachment.followers.add(holder);
        const release = (): void => {
            attachment.followers.delete(holder);
            void this.releaseUnused(nodeId, attachment);
        };
        try {
            if (!attachment.attached) {
                const pending = [...attachment.pending].at(-1);
                if (pending) {
                    await pending;
                } else {
                    const following = this.requestAttachment(nodeId, attachment, { sessionId: nodeId, follow: true });
                    attachment.following = following;
                    try {
                        await following;
                    } finally {
                        attachment.following = null;
                    }
                }
            }
            if (this.disposed || this.attachments.get(nodeId) !== attachment) {
                throw disconnected();
            }
            return release;
        } catch (error) {
            release();
            throw error;
        }
    }

    async detach(nodeId: string): Promise<void> {
        this.mounted.delete(nodeId);
        const attachment = this.attachments.get(nodeId);
        if (attachment) {
            attachment.renderer = null;
            await this.releaseUnused(nodeId, attachment);
        } else {
            this.sink.setAttached(nodeId, false);
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
        this.attachments.delete(nodeId);
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

    /* Lets go of the machine without ending its sessions; the daemon only stops streaming to this socket. */
    dispose(): void {
        this.disposed = true;
        this.mounted.clear();
        for (const [nodeId, attachment] of this.attachments) {
            attachment.renderer = null;
            attachment.followers.clear();
            void this.releaseUnused(nodeId, attachment);
        }
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe.length = 0;
    }

    /*
     * The agent in every shell on this machine, attached or not. `session.status` only carries a
     * change, so a workspace that just opened asks for the standing answer.
     */
    async loadStatuses(): Promise<void> {
        const sessions = await this.listSessions();
        for (const session of sessions ?? []) {
            if (session.agent) {
                this.sink.setAgent(session.sessionId, session.agent);
            }
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
        // The server drops every attachment with the connection; old replies and releases belong to that connection only.
        for (const nodeId of this.attachments.keys()) {
            this.sink.setAttached(nodeId, false);
        }
        this.attachments.clear();
        this.mounted.detachAll((nodeId) => this.sink.setAttached(nodeId, false));
    }

    private async reattach(nodeId: string, entry: Mounted, sessions: () => Promise<SessionInfo[] | null>): Promise<void> {
        const attachment = this.register(nodeId, entry);
        await this.ensure(nodeId, { cwd: entry.cwd, command: entry.command, agent: entry.agent, follow: entry.follow }, entry.cols, entry.rows);
        // The node may have left the canvas while the create was on the wire, or mounted again with an open of its own.
        if (!this.isCurrent(nodeId, entry, attachment)) {
            return;
        }
        const result = await this.attachWith(nodeId, entry.cols, entry.rows, sessions);
        if (result === null) {
            return;
        }
        this.sizeHandlers.fanOut(nodeId, { cols: result.cols, rows: result.rows });
        this.screenHandlers.fanOut(nodeId, result);
    }

    /* Null when the node left while the attach was on the wire. */
    private async attachWith(nodeId: string, cols: number, rows: number, sessions: () => Promise<SessionInfo[] | null>): Promise<SessionAttachResult | null> {
        if (this.disposed) {
            return null;
        }
        const entry: Mounted = { ...this.opens.get(nodeId), cols, rows, attached: false };
        const attachment = this.register(nodeId, entry);
        try {
            // A hidden follow's unused snapshot must finish before the renderer takes its current screen.
            if (attachment.following) {
                await attachment.following.catch(() => undefined);
                if (!this.isCurrent(nodeId, entry, attachment)) {
                    return null;
                }
            }
            const result = await this.requestAttachment(nodeId, attachment, { sessionId: nodeId, cols: entry.cols, rows: entry.rows });
            if (!this.isCurrent(nodeId, entry, attachment)) {
                return null;
            }
            entry.attached = true;
            void this.settle(nodeId, result, sessions);
            return result;
        } catch (e) {
            if (!isConnectionError(e)) {
                this.unregister(nodeId, entry, attachment);
            }
            throw e;
        }
    }

    private attachment(nodeId: string): Attachment {
        let attachment = this.attachments.get(nodeId);
        if (!attachment) {
            attachment = { renderer: null, followers: new Set(), attached: false, pending: new Set(), following: null };
            this.attachments.set(nodeId, attachment);
        }
        return attachment;
    }

    private register(nodeId: string, entry: Mounted): Attachment {
        this.mounted.set(nodeId, entry);
        const attachment = this.attachment(nodeId);
        attachment.renderer = entry;
        return attachment;
    }

    private unregister(nodeId: string, entry: Mounted, attachment: Attachment): void {
        if (this.mounted.get(nodeId) === entry) {
            this.mounted.delete(nodeId);
        }
        if (attachment.renderer === entry) {
            attachment.renderer = null;
        }
        void this.releaseUnused(nodeId, attachment);
    }

    private isCurrent(nodeId: string, entry: Mounted, attachment: Attachment): boolean {
        return this.mounted.get(nodeId) === entry && this.attachments.get(nodeId) === attachment;
    }

    private requestAttachment(nodeId: string, attachment: Attachment, payload: SessionAttachPayload): Promise<SessionAttachResult> {
        const pending = this.transport
            .request('session.attach', payload)
            .then((result) => {
                if (this.attachments.get(nodeId) === attachment) {
                    attachment.attached = true;
                    if (attachment.renderer || attachment.followers.size > 0) {
                        this.sink.setAttached(nodeId, true);
                    }
                }
                return result;
            })
            .finally(() => {
                attachment.pending.delete(pending);
                void this.releaseUnused(nodeId, attachment);
            });
        attachment.pending.add(pending);
        return pending;
    }

    private async releaseUnused(nodeId: string, attachment: Attachment): Promise<void> {
        if (this.attachments.get(nodeId) !== attachment || attachment.renderer || attachment.followers.size > 0) {
            return;
        }
        this.sink.setAttached(nodeId, false);
        // A request can still establish the server attachment after its last owner left.
        if (attachment.pending.size > 0) {
            return;
        }
        this.attachments.delete(nodeId);
        if (attachment.attached) {
            try {
                await this.transport.request('session.detach', { sessionId: nodeId });
            } catch {
                // Closing the connection releases the server attachment as well.
            }
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
        if (info !== null) {
            this.sink.setAccount(nodeId, info.account);
        }
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

function disconnected(): TransportError {
    return new TransportError('disconnected', 'The session client is disconnected.');
}
