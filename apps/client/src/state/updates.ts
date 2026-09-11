import { create } from 'zustand';
import { desktop, type UpdateState } from '@/desktop/bridge';

interface UpdatesStore extends UpdateState {
    /* Whether there is an updater to talk to at all: false in a browser and in a checkout. */
    supported: boolean;
    check(): Promise<void>;
    download(): Promise<void>;
    install(): void;
}

export const useUpdates = create<UpdatesStore>(() => ({
    status: 'unsupported',
    currentVersion: '',
    supported: false,
    async check() {
        await desktop()?.checkForUpdate?.();
    },
    async download() {
        await desktop()?.downloadUpdate?.();
    },
    install() {
        desktop()?.installUpdate?.();
    }
}));

/* The green button in the toolbar: there is something to do, and one click leads to it. */
export const hasUpdate = (state: UpdateState): boolean => state.status === 'available' || state.status === 'downloading' || state.status === 'ready';

/* The line the Updates pane leads with. The detail is empty where the headline says it all. */
export const describeUpdate = (state: UpdateState): { headline: string; detail: string } => {
    switch (state.status) {
        case 'unsupported':
            return {
                headline: 'Updates come from the desktop app',
                detail: 'A browser follows whichever machine it is pointed at, and a checkout updates with git.'
            };
        case 'checking':
            return { headline: 'Looking for a newer version', detail: '' };
        case 'available':
            return { headline: `Version ${state.version ?? 'unknown'} is available`, detail: 'Download it now, or let it come down on its own.' };
        case 'downloading':
            return { headline: `Downloading ${state.version ?? 'the update'}`, detail: `${Math.round(state.percent ?? 0)}% of the way.` };
        case 'ready':
            return {
                headline: `Version ${state.version ?? 'unknown'} is ready`,
                detail: 'Ruimte restarts to install it. Nothing you have open is lost: sessions live on the machine.'
            };
        case 'error':
            return { headline: 'The last check did not finish', detail: state.error ?? 'No reason given.' };
        default:
            return { headline: 'Ruimte is up to date', detail: '' };
    }
};

const apply = (state: UpdateState): void => useUpdates.setState({ ...state, supported: state.status !== 'unsupported' });

/* Whether the shell downloads on its own. Pushed again whenever the setting changes. */
export const setAutoDownload = async (autoDownload: boolean): Promise<void> => {
    await desktop()?.configureUpdates?.(autoDownload);
};

/*
 * Wires the store to the shell: the state it already has and every change after it. The first check
 * waits until the auto-download preference has landed, so nothing downloads behind the back of
 * someone who turned it off. Returns the unsubscribe, or null where there is no shell to talk to.
 */
export const startUpdates = (autoDownload: boolean): (() => void) | null => {
    const bridge = desktop();
    if (!bridge?.updateState || !bridge.onUpdateState) {
        return null;
    }
    const stop = bridge.onUpdateState(apply);
    void bridge.updateState().then(async (state) => {
        apply(state);
        if (state.status === 'unsupported') {
            return;
        }
        await setAutoDownload(autoDownload);
        await bridge.checkForUpdate?.();
    });
    return stop;
};
