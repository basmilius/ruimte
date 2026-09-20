import type { AgentStatus, ProjectSidebarResult } from '@ruimte/contracts';
import { TransportError, type Transport } from '@/transport/transport';

export interface SidebarMachineSnapshot {
    projects: ProjectSidebarResult['projects'];
    statuses: Record<string, AgentStatus>;
    state: 'loading' | 'ready' | 'offline' | 'error' | 'unsupported';
}

export class SidebarWatch {
    private snapshot: SidebarMachineSnapshot = { projects: [], statuses: {}, state: 'loading' };
    private readonly listeners = new Set<() => void>();
    private readonly off: (() => void)[];
    private readonly interval: ReturnType<typeof setInterval>;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;
    private loading = false;
    private again = false;
    private generation = 0;
    private statusRevision = 0;

    private readonly transport: Transport;

    constructor(transport: Transport, pollMs = 15_000) {
        this.transport = transport;
        this.off = [
            transport.subscribeStatus((status) => {
                this.generation++;
                if (status === 'open') {
                    this.set({ ...this.snapshot, state: 'loading' });
                    this.refresh();
                } else this.set({ ...this.snapshot, state: 'offline' });
            }),
            transport.on('project.changed', () => this.schedule()),
            transport.on('project.summary', () => this.schedule()),
            transport.on('session.list-changed', () => this.schedule()),
            transport.on('session.status', ({ sessionId, agent }) => this.status(`terminal:${sessionId}`, agent?.status ?? 'running')),
            transport.on('session.exit', ({ sessionId }) => this.status(`terminal:${sessionId}`, 'exited')),
            transport.on('chat.status', ({ chatId, info }) => this.status(`chat:${chatId}`, info.status))
        ];
        // Released projects have no file watcher; refresh also picks up external edits and new projects.
        this.interval = setInterval(() => this.refresh(), pollMs);
        this.refresh();
    }

    getSnapshot = (): SidebarMachineSnapshot => this.snapshot;
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    dispose(): void {
        this.disposed = true;
        this.off.forEach((off) => off());
        clearInterval(this.interval);
        if (this.timer !== null) clearTimeout(this.timer);
        this.listeners.clear();
    }

    private status(key: string, status: AgentStatus): void {
        this.statusRevision++;
        this.set({ ...this.snapshot, statuses: { ...this.snapshot.statuses, [key]: status } });
    }

    private schedule(): void {
        if (this.timer !== null) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.refresh();
        }, 150);
    }

    private set(snapshot: SidebarMachineSnapshot): void {
        if (this.disposed || JSON.stringify(snapshot) === JSON.stringify(this.snapshot)) return;
        this.snapshot = snapshot;
        this.listeners.forEach((listener) => listener());
    }

    refresh = (): void => {
        if (this.disposed || this.snapshot.state === 'unsupported') return;
        if (this.transport.status !== 'open') {
            this.set({ ...this.snapshot, state: 'offline' });
            return;
        }
        if (this.loading) {
            this.again = true;
            return;
        }
        this.loading = true;
        const generation = this.generation;
        const revision = this.statusRevision;
        void Promise.all([this.transport.request('project.sidebar', {}), this.transport.request('session.list', {}), this.transport.request('chat.list', {})])
            .then(([overview, sessions, chats]) => {
                if (this.disposed || generation !== this.generation) return;
                const statuses: Record<string, AgentStatus> = {};
                for (const session of sessions.sessions) {
                    statuses[`terminal:${session.sessionId}`] =
                        session.agent?.live || session.agent?.status === 'exited' ? session.agent.status : session.exited ? 'error' : 'running';
                }
                for (const chat of chats.chats) statuses[`chat:${chat.chatId}`] = chat.status;
                // An event received during the request is newer than that request's status snapshot.
                if (revision !== this.statusRevision) this.again = true;
                this.set({ projects: overview.projects, statuses: revision === this.statusRevision ? statuses : this.snapshot.statuses, state: 'ready' });
            })
            .catch((error: unknown) => {
                if (generation !== this.generation) return;
                const unsupported =
                    error instanceof TransportError && ['unknown-request', 'unknown-type', 'bad-request', 'not-implemented'].includes(error.code);
                this.set({ ...this.snapshot, state: unsupported ? 'unsupported' : this.transport.status === 'open' ? 'error' : 'offline' });
            })
            .finally(() => {
                this.loading = false;
                if (this.again && !this.disposed) {
                    this.again = false;
                    this.refresh();
                }
            });
    };
}
