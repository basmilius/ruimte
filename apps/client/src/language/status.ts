import type { LanguageLogLine, LanguageServerKind, LanguageServerStatus } from '@ruimte/contracts';
import type { Transport } from '@/transport/transport';

/*
 * What a project knows about its language servers: a status per kind, which a person's Install and
 * Restart change and the daemon's events keep up to date. The snapshot is replaced on every change, so
 * a store can read it as one. Nothing here installs on its own: only `install` asks the daemon to.
 */
export class LanguageStatusTracker {
    private readonly transport: Transport;
    private readonly projectId: string;
    private readonly listeners = new Set<() => void>();
    private readonly subscriptions: Array<() => void> = [];
    private snapshot: readonly LanguageServerStatus[] = [];
    private linkWasDown: boolean;

    constructor(transport: Transport, projectId: string) {
        this.transport = transport;
        this.projectId = projectId;
        this.linkWasDown = transport.status !== 'open';
        this.subscriptions.push(
            // A server of a person's own was saved or removed, so which servers a project has changed with it.
            transport.on('language.custom.changed', () => {
                void this.refresh().catch(() => undefined);
            }),
            transport.on('language.status', (event) => {
                if (event.projectId === this.projectId) {
                    this.set(event.status);
                } else if (event.projectId === null) {
                    this.machineChanged(event.status);
                }
            }),
            transport.subscribeStatus((status) => {
                if (status !== 'open') {
                    this.linkWasDown = true;
                } else if (this.linkWasDown) {
                    this.linkWasDown = false;
                    void this.refresh().catch(() => undefined);
                }
            })
        );
    }

    getSnapshot(): readonly LanguageServerStatus[] {
        return this.snapshot;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    async refresh(): Promise<void> {
        const { servers } = await this.transport.request('language.status', { projectId: this.projectId });
        this.snapshot = servers;
        this.emit();
    }

    /* A person pressed Install. The answer is the kind installing; its end comes as an event. */
    async install(server: LanguageServerKind): Promise<void> {
        const { status } = await this.transport.request('language.install', { server });
        this.machineChanged(status);
    }

    /* A person went back to the version a kind ran before the one it runs. */
    async rollback(server: LanguageServerKind): Promise<void> {
        const { status } = await this.transport.request('language.rollback', { server });
        this.machineChanged(status);
    }

    /* A person chose this server for its language over the one that serves it otherwise. The other one's change comes as an event. */
    async prefer(server: LanguageServerKind): Promise<void> {
        const { status } = await this.transport.request('language.prefer', { server });
        this.machineChanged(status);
    }

    async restart(server: string): Promise<void> {
        const { status } = await this.transport.request('language.restart', { projectId: this.projectId, server });
        this.set(status);
    }

    async log(server: string): Promise<LanguageLogLine[]> {
        return (await this.transport.request('language.log', { projectId: this.projectId, server })).lines;
    }

    dispose(): void {
        for (const unsubscribe of this.subscriptions.splice(0)) {
            unsubscribe();
        }
        this.listeners.clear();
    }

    /* An install began or ended on the machine. One that ended leaves the kind to the project, so its own state is asked for. */
    private machineChanged(status: LanguageServerStatus): void {
        if (status.state === 'installing' || status.state === 'not-installed') {
            this.set({ ...status, documents: this.snapshot.find((candidate) => candidate.server === status.server)?.documents ?? 0 });
            return;
        }
        void this.refresh().catch(() => undefined);
    }

    private set(status: LanguageServerStatus): void {
        const known = this.snapshot.some((candidate) => candidate.server === status.server);
        this.snapshot = known ? this.snapshot.map((candidate) => (candidate.server === status.server ? status : candidate)) : [...this.snapshot, status];
        this.emit();
    }

    private emit(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }
}
