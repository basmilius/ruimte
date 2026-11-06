import type { MachineMode } from '@ruimte/desktop-bridge';
import type { MachineModeFile } from '../machine-mode';
import type { DesktopIpc } from './ipc';
import type { Machine } from './service';

export interface MachineModeOptions {
    mode: MachineMode;
    machine: Pick<Machine, 'stopPreview' | 'stopOnQuit' | 'removeOwnService'>;
    store: MachineModeFile;
    /* Quits and starts the app again, without the question the page already asked. */
    relaunch(): void;
    /* Runs after the current call, so the reply reaches the page before the windows go. */
    later?(run: () => void): void;
}

/* The page chooses whether this app runs a machine; the shell writes it and starts over with it. */
export function installMachineMode(ipc: DesktopIpc, options: MachineModeOptions): void {
    const { machine, store } = options;
    const later = options.later ?? ((run: () => void) => void setTimeout(run, 0));
    // Once a choice is on its way the app is going down, and a second one would write over it.
    let switching = false;

    ipc.handle('machine:stop-preview', () => machine.stopPreview());
    ipc.handle('machine:choose', (_event, next: unknown) => {
        if (next !== 'local' && next !== 'none') {
            throw new Error('Unknown machine mode');
        }
        if (switching) {
            throw new Error('The app is already switching');
        }
        const stopMachine = options.mode === 'local' && next === 'none';
        switching = true;
        try {
            // A write that fails rejects here, before anything stopped.
            store.write(next);
            if (stopMachine) {
                try {
                    machine.removeOwnService();
                } catch (e) {
                    // The next start must find the mode it ran with, or the definition it could not remove would start a machine the app says is gone.
                    store.write(options.mode);
                    throw e;
                }
            }
        } catch (e) {
            switching = false;
            throw e;
        }
        machine.stopOnQuit(stopMachine);
        later(options.relaunch);
    });
}
