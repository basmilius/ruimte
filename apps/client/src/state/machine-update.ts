import { MachineUpdateStatusSchema, type MachineUpdateReport } from '@ruimte/contracts';
import type { UpdateState } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import type { Transport } from '@/transport/transport';
import { watchPool, type WatchablePool } from '@/transport/pool-watch';

/*
 * The shell's updater told to this computer's own machine, so a phone sees the update of this computer
 * and can ask for it to be installed. Only the app on the machine holds the updater; the machine only
 * passes what it says along and hands an install back to it.
 */

/* What the machine is told, or null for a step this wire does not know yet, which then tells nothing. */
export function machineReportOf(state: UpdateState): MachineUpdateReport | null {
    const status = MachineUpdateStatusSchema.safeParse(state.status);
    if (!status.success) {
        return null;
    }
    return {
        status: status.data,
        ...(state.currentVersion ? { currentVersion: state.currentVersion.slice(0, 64) } : {}),
        ...(state.version ? { version: state.version.slice(0, 64) } : {}),
        ...(state.percent === undefined ? {} : { percent: Math.min(100, Math.max(0, state.percent)) }),
        ...(state.error ? { error: state.error.slice(0, 1000) } : {})
    };
}

export type InstallStep = 'install' | 'download' | 'wait' | 'none';

/* What a requested install does now: a ready update installs, one not yet fetched downloads first. */
export function installStep(status: UpdateState['status']): InstallStep {
    switch (status) {
        case 'ready':
            return 'install';
        case 'available':
            return 'download';
        case 'downloading':
            return 'wait';
        default:
            return 'none';
    }
}

export interface MachineUpdateShell {
    state(): UpdateState;
    download(): Promise<void>;
    /* Installs without the shell's own question, which the person answered on the client that asked. */
    install(): void;
}

/*
 * Reports every step to the local machine and installs when it hands one back. Returns the call that
 * feeds it the shell's states and the one that stops it. A machine from before answers
 * `unknown-request`, which changes nothing here.
 */
export function startMachineUpdate(shell: MachineUpdateShell, source?: WatchablePool): { apply(state: UpdateState): void; stop(): void } {
    let local: Transport | null = null;
    // Set by a requested install that waits for the download to finish.
    let installWhenReady = false;

    const report = (state: UpdateState): void => {
        const payload = machineReportOf(state);
        if (local?.status !== 'open' || payload === null) {
            return;
        }
        void local.request('endpoint.reportUpdate', payload).catch(() => undefined);
    };

    const proceed = (state: UpdateState): void => {
        const step = installStep(state.status);
        installWhenReady = step === 'download' || step === 'wait';
        if (step === 'install') {
            shell.install();
        } else if (step === 'download') {
            void shell.download().catch(() => {
                installWhenReady = false;
            });
        }
    };

    const stop = watchPool((link, endpointId) => {
        if (endpointId !== LOCAL_ENDPOINT_ID) {
            return { subscriptions: [] };
        }
        local = link;
        return {
            onOpen: () => report(shell.state()),
            subscriptions: [
                link.on('endpoint.updateInstall', () => proceed(shell.state())),
                () => {
                    if (local === link) {
                        local = null;
                    }
                }
            ]
        };
    }, source);

    return {
        apply(state) {
            report(state);
            if (installWhenReady && (state.status === 'ready' || state.status === 'error')) {
                installWhenReady = false;
                if (state.status === 'ready') {
                    shell.install();
                }
            }
        },
        stop
    };
}
