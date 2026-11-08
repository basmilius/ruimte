import type { LanguageLogLine, LanguageServerKind, LanguageServerStatus, LanguageTraceValue } from '@ruimte/contracts';
import { machineAnswers } from '@/transport/features';
import type { Transport } from '@/transport/transport';
import { SnapshotTracker, upsert } from './snapshot-tracker';

/*
 * What a project knows about its language servers: a status per kind, which a person's Install and
 * Restart change and the daemon's events keep up to date. Nothing here installs on its own: only
 * `install` asks the daemon to.
 */
export class LanguageStatusTracker extends SnapshotTracker<readonly LanguageServerStatus[]> {
    private readonly projectId: string;

    constructor(transport: Transport, projectId: string) {
        super(transport, []);
        this.projectId = projectId;
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
            })
        );
    }

    async refresh(): Promise<void> {
        this.replace((await this.transport.request('language.status', { projectId: this.projectId })).servers);
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

    /* Whether the machine can let servers build code in the worktrees of agents, which a machine from before it cannot. */
    canAllowWorktreeBuild(): boolean {
        return machineAnswers(this.transport.connection, 'language.worktreeBuild');
    }

    /* A person lets the servers of this repository build scripts and macros in the worktrees of agents; only the local secret may. */
    async allowWorktreeBuild(): Promise<void> {
        this.replace((await this.transport.request('language.worktreeBuild', { projectId: this.projectId, on: true })).servers);
    }

    async log(server: string): Promise<LanguageLogLine[]> {
        return (await this.transport.request('language.log', { projectId: this.projectId, server })).lines;
    }

    /* Whether the machine can switch a server's trace, which a machine from before it cannot. */
    canTrace(): boolean {
        return machineAnswers(this.transport.connection, 'language.trace');
    }

    /* Switches what the server traces to the log. The machine keeps it in memory only. */
    async trace(server: string, value: LanguageTraceValue): Promise<void> {
        if (!this.canTrace()) {
            return;
        }

        const { status } = await this.transport.request('language.trace', { projectId: this.projectId, server, value });
        this.set(status);
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
        this.replace(upsert(this.snapshot, status, (candidate) => candidate.server === status.server));
    }
}
