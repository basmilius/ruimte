import { projectSidebarViews, type AgentStatus, type ProjectChangedEvent, type ProjectSidebarResult, type ProjectSummaryEvent } from '@ruimte/contracts';
import type { Transport } from '@/transport/transport';

export interface SidebarMachineSnapshot {
    projects: ProjectSidebarResult['projects'];
    statuses: Record<string, AgentStatus>;
    waitingSince: Record<string, number>;
    state: 'loading' | 'ready' | 'offline' | 'error';
}

/* What one request brings: the projects, or the standing status of every terminal or every chat. */
type Part = 'projects' | 'sessions' | 'chats';

const ALL_PARTS: readonly Part[] = ['projects', 'sessions', 'chats'];

export interface SidebarWatchOptions {
    pollMs?: number;
    /* Whether this page polls now. Every window draws a sidebar, and only the one with the focus has to. */
    polls?: () => boolean;
}

function focusedPage(): boolean {
    return typeof document === 'undefined' || document.hasFocus();
}

function statusKeyOf(part: Part): string | null {
    return part === 'sessions' ? 'terminal:' : part === 'chats' ? 'chat:' : null;
}

function sameValues<Value>(left: Readonly<Record<string, Value>>, right: Readonly<Record<string, Value>>): boolean {
    if (left === right) {
        return true;
    }
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function waitingAt(status: AgentStatus, requests: readonly { createdAt: number }[] = [], previous?: number, fallback?: number): number | null {
    if (status !== 'needs-you') {
        return null;
    }

    const dates = requests.map((request) => request.createdAt).filter((at) => Number.isFinite(at) && at > 0);

    return dates.length > 0 ? Math.min(...dates) : (previous ?? (fallback !== undefined && fallback > 0 ? fallback : Infinity));
}

function sameProjects(left: SidebarMachineSnapshot['projects'], right: SidebarMachineSnapshot['projects']): boolean {
    return (
        left === right ||
        (left.length === right.length && left.every((project, index) => project === right[index] || JSON.stringify(project) === JSON.stringify(right[index])))
    );
}

export class SidebarWatch {
    private snapshot: SidebarMachineSnapshot = { projects: [], statuses: {}, waitingSince: {}, state: 'loading' };
    private readonly listeners = new Set<() => void>();
    private readonly off: (() => void)[];
    private readonly interval: ReturnType<typeof setInterval>;
    private readonly queued = new Set<Part>();
    private disposed = false;
    private loading = false;
    private generation = 0;
    // The statuses an event set while a list was out, which are newer than that list.
    private touched = new Set<string>();

    private readonly transport: Transport;

    constructor(transport: Transport, { pollMs = 15_000, polls = focusedPage }: SidebarWatchOptions = {}) {
        this.transport = transport;
        this.off = [
            transport.subscribeStatus((status) => {
                this.generation++;
                this.queued.clear();
                if (status === 'open') {
                    this.set({ ...this.snapshot, state: 'loading' });
                    this.refresh();
                } else {
                    this.set({ ...this.snapshot, state: 'offline' });
                }
            }),
            transport.on('project.changed', (event) => this.changed(event)),
            transport.on('project.summary', (event) => this.summary(event)),
            transport.on('session.list-changed', () => this.queue(['sessions'])),
            transport.on('session.status', ({ sessionId, agent }) =>
                this.status(`terminal:${sessionId}`, agent?.status ?? 'running', agent?.requests, agent?.updatedAt)
            ),
            transport.on('session.exit', ({ sessionId }) => this.status(`terminal:${sessionId}`, 'exited')),
            transport.on('chat.status', ({ chatId, info }) => this.status(`chat:${chatId}`, info.status, info.requests))
        ];
        // A project no client has open has no watcher on the machine, so an edit from outside reaches no event.
        this.interval = setInterval(() => {
            if (polls()) {
                this.queue(['projects']);
            }
        }, pollMs);
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
        this.listeners.clear();
    }

    /* Everything again, as on a fresh link. */
    refresh = (): void => {
        this.queue(ALL_PARTS);
    };

    private status(key: string, status: AgentStatus, requests?: readonly { createdAt: number }[], fallback?: number): void {
        this.touched.add(key);
        const at = waitingAt(status, requests, this.snapshot.waitingSince[key], fallback);

        if (this.snapshot.statuses[key] === status && this.snapshot.waitingSince[key] === (at ?? undefined)) {
            return;
        }

        const waitingSince = { ...this.snapshot.waitingSince };

        if (at === null) {
            delete waitingSince[key];
        } else {
            waitingSince[key] = at;
        }

        this.set({ ...this.snapshot, statuses: { ...this.snapshot.statuses, [key]: status }, waitingSince });
    }

    /* The document comes along to a client that holds the project, so its rows come from it without asking. */
    private changed({ projectId, document }: ProjectChangedEvent): void {
        const known = this.snapshot.projects.some((project) => project.summary.projectId === projectId);
        if (!known || this.snapshot.state !== 'ready') {
            this.queue(['projects']);
            return;
        }
        const views = projectSidebarViews(document.views, document.shared ?? [], document.flags);
        this.set({
            ...this.snapshot,
            projects: this.snapshot.projects.map((project) => (project.summary.projectId === projectId ? { ...project, views } : project))
        });
    }

    /* Every other client gets the rows of a changed document here, from a machine that sends them. */
    private summary({ summary, views }: ProjectSummaryEvent): void {
        const known = this.snapshot.projects.some((project) => project.summary.projectId === summary.projectId);
        // A closed project leaves the list and a new one joins it, which only the machine's list says in full.
        if (!known || summary.closedAt != null || this.snapshot.state !== 'ready') {
            this.queue(['projects']);
            return;
        }
        this.set({
            ...this.snapshot,
            projects: this.snapshot.projects.map((project) =>
                project.summary.projectId === summary.projectId ? { ...project, summary, ...(views ? { views } : {}) } : project
            )
        });
    }

    private set(snapshot: SidebarMachineSnapshot): void {
        if (
            this.disposed ||
            (snapshot.state === this.snapshot.state &&
                sameValues(snapshot.statuses, this.snapshot.statuses) &&
                sameValues(snapshot.waitingSince, this.snapshot.waitingSince) &&
                sameProjects(snapshot.projects, this.snapshot.projects))
        ) {
            return;
        }
        this.snapshot = snapshot;
        this.listeners.forEach((listener) => listener());
    }

    /*
     * Asked at once, in the turn of the event, so a list another client of the machine asks for in that
     * turn is one request (`ActiveTransport`). While a round is out the next one gathers and waits.
     */
    private queue(parts: readonly Part[]): void {
        if (this.disposed) {
            return;
        }
        if (this.transport.status !== 'open') {
            this.set({ ...this.snapshot, state: 'offline' });
            return;
        }
        // After a failed round the parts it lacked are not known to be current, so the next asks for all of them.
        for (const part of this.snapshot.state === 'error' ? ALL_PARTS : parts) {
            this.queued.add(part);
        }
        this.load();
    }

    private load(): void {
        if (this.disposed || this.loading || this.queued.size === 0 || this.transport.status !== 'open') {
            return;
        }
        const parts = [...this.queued];
        this.queued.clear();
        this.loading = true;
        this.touched = new Set();
        const generation = this.generation;
        const wants = (part: Part): boolean => parts.includes(part);
        void Promise.all([
            wants('projects') ? this.transport.request('project.sidebar', {}) : null,
            wants('sessions') ? this.transport.request('session.list', {}) : null,
            wants('chats') ? this.transport.request('chat.list', {}) : null
        ])
            .then(([overview, sessions, chats]) => {
                if (this.disposed || generation !== this.generation) {
                    return;
                }
                const fetched: Record<string, AgentStatus> = {};
                const waitingSince: Record<string, number> = {};

                const remember = (key: string, status: AgentStatus, requests?: readonly { createdAt: number }[], fallback?: number): void => {
                    if (this.touched.has(key)) {
                        return;
                    }

                    fetched[key] = status;
                    const at = waitingAt(status, requests, this.snapshot.waitingSince[key], fallback);

                    if (at !== null) {
                        waitingSince[key] = at;
                    }
                };

                for (const session of sessions?.sessions ?? []) {
                    remember(
                        `terminal:${session.sessionId}`,
                        session.agent?.live || session.agent?.status === 'exited' ? session.agent.status : session.exited ? 'error' : 'running',
                        session.agent?.requests,
                        session.agent?.updatedAt
                    );
                }
                for (const chat of chats?.chats ?? []) {
                    remember(`chat:${chat.chatId}`, chat.status, chat.requests);
                }
                const replaced = parts.map(statusKeyOf).filter((prefix): prefix is string => prefix !== null);
                // A list replaces every status of its kind, except one an event set while the list was out.
                const kept = Object.entries(this.snapshot.statuses).filter(
                    ([key]) => this.touched.has(key) || !replaced.some((prefix) => key.startsWith(prefix))
                );
                const keptDates = Object.entries(this.snapshot.waitingSince).filter(
                    ([key]) => this.touched.has(key) || !replaced.some((prefix) => key.startsWith(prefix))
                );

                this.set({
                    projects: overview?.projects ?? this.snapshot.projects,
                    statuses: { ...fetched, ...Object.fromEntries(kept) },
                    waitingSince: { ...waitingSince, ...Object.fromEntries(keptDates) },
                    state: 'ready'
                });
            })
            .catch(() => {
                if (generation !== this.generation) {
                    return;
                }
                this.set({ ...this.snapshot, state: this.transport.status === 'open' ? 'error' : 'offline' });
            })
            .finally(() => {
                this.loading = false;
                this.load();
            });
    }
}
