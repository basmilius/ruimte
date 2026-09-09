import type { SessionAttachResult } from '@ruimte/contracts';
import type { SessionSink } from '../state/sessions';
import { TransportError, type Transport, type TransportStatus } from '../transport/transport';

export type OutputHandler = (data: string) => void;
export type ExitHandler = (exitCode: number) => void;
export type ScreenHandler = (result: SessionAttachResult) => void;

interface Mounted {
    cwd: string | undefined;
    cols: number;
    rows: number;
    /* False between a lost connection (or a failed attach) and the next successful attach. */
    attached: boolean;
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
    private readonly mounted = new Map<string, Mounted>();
    private readonly cwds = new Map<string, string | undefined>();
    private readonly outputHandlers = new Map<string, Set<OutputHandler>>();
    private readonly exitHandlers = new Map<string, Set<ExitHandler>>();
    private readonly screenHandlers = new Map<string, Set<ScreenHandler>>();
    private readonly unsubscribe: Array<() => void> = [];

    constructor(transport: Transport, sink: SessionSink) {
        this.transport = transport;
        this.sink = sink;
        this.unsubscribe.push(
            transport.on('session.output', ({ sessionId, data }) => this.fanOut(this.outputHandlers, sessionId, data)),
            transport.on('session.exit', ({ sessionId, exitCode }) => {
                this.sink.setExited(sessionId, exitCode);
                this.fanOut(this.exitHandlers, sessionId, exitCode);
            }),
            transport.subscribeStatus((status) => this.onStatus(status))
        );
    }

    async ensure(nodeId: string, cwd: string | undefined, cols: number, rows: number): Promise<void> {
        this.cwds.set(nodeId, cwd);
        try {
            await this.transport.request('session.create', { sessionId: nodeId, cwd, cols, rows });
            this.sink.setExited(nodeId, undefined);
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
    async open(nodeId: string, cwd: string | undefined, cols: number, rows: number): Promise<SessionAttachResult | null> {
        this.mounted.set(nodeId, { cwd, cols, rows, attached: false });
        try {
            await this.ensure(nodeId, cwd, cols, rows);
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
        this.mounted.set(nodeId, { cwd: this.cwds.get(nodeId), cols, rows, attached: false });
        try {
            const result = await this.transport.request('session.attach', { sessionId: nodeId, cols, rows });
            const entry = this.mounted.get(nodeId);
            if (entry) {
                entry.attached = true;
                this.sink.setAttached(nodeId, true);
            }
            if (result.exited) {
                this.sink.setExited(nodeId, await this.exitCodeOf(nodeId));
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
        this.cwds.delete(nodeId);
        this.sink.forget(nodeId);
        await this.transport.request('session.kill', { sessionId: nodeId });
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
            try {
                await this.ensure(nodeId, entry.cwd, entry.cols, entry.rows);
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

    // The attach reply says only that the shell ended; the code is on the list entry.
    private async exitCodeOf(nodeId: string): Promise<number> {
        try {
            const { sessions } = await this.transport.request('session.list', {});
            return sessions.find((session) => session.sessionId === nodeId)?.exitCode ?? 0;
        } catch {
            return 0;
        }
    }
}
