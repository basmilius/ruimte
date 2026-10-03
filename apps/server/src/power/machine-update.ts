import type { MachineUpdate, MachineUpdateReport, MachineWork } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import type { SessionSink } from '../sessions/manager.ts';

const NO_APP: MachineUpdate = { app: false, status: 'unsupported' };

// Only a step a person can act on lets a client ask for the install; the app downloads first where it has not yet.
const INSTALLABLE: ReadonlySet<MachineUpdate['status']> = new Set(['available', 'downloading', 'ready']);

/* What the event compares, so a download says a new percent once per whole step and not per chunk. */
const said = (update: MachineUpdate): string => JSON.stringify({ ...update, percent: update.percent === undefined ? undefined : Math.floor(update.percent) });

export type InstallVerdict = 'no-app' | 'nothing' | 'asked';

/*
 * The update of the desktop app on this machine, as that app tells it. The daemon cannot install a
 * release itself: only the app holds the updater, so the state is what the app on the local secret
 * last said, and a request to install goes back to it. A window that closes takes its report along,
 * and a machine without one (a daemon from npm, the service while the app is closed) says so.
 */
export class MachineUpdates {
    private readonly sinks = new ClientSinks((clientId) => this.forget(clientId));
    // Insertion order is report order, so the last entry is the app window that spoke last.
    private readonly reports = new Map<string, MachineUpdateReport>();
    private announced = said(NO_APP);

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    state(): MachineUpdate {
        const report = [...this.reports.values()].at(-1);
        return report === undefined ? NO_APP : { ...report, app: true };
    }

    /* Callers check that the client holds the local secret; only the app on this machine speaks for it. */
    report(clientId: string, report: MachineUpdateReport): void {
        this.reports.delete(clientId);
        this.reports.set(clientId, report);
        this.announce();
    }

    /* Hands the install to the app window that reported last, which is the one that is surely still there. */
    requestInstall(): InstallVerdict {
        const clientId = [...this.reports.keys()].at(-1);
        if (clientId === undefined) {
            return 'no-app';
        }
        if (!INSTALLABLE.has(this.state().status)) {
            return 'nothing';
        }
        this.sinks.to(clientId, { event: 'endpoint.updateInstall', payload: {} });
        return 'asked';
    }

    private forget(clientId: string): void {
        if (this.reports.delete(clientId)) {
            this.announce();
        }
    }

    private announce(): void {
        const update = this.state();
        const next = said(update);
        if (next === this.announced) {
            return;
        }
        this.announced = next;
        this.sinks.emit({ event: 'endpoint.updateChanged', payload: { update } });
    }
}

/* What a restart of the app ends: nothing when the daemon runs as the service and outlives it, else whatever runs. */
export const workEndedByInstall = (underService: boolean, work: MachineWork): MachineWork => (underService ? { terminals: 0, agents: 0 } : work);
