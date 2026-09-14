import { create } from 'zustand';
import { desktop, type UpdateState } from '@/desktop/bridge';
import { compareVersions, isVersion, openReleaseNotes, setPreviousSeenVersion } from '@/state/release-notes';
import { useToasts } from '@/state/toasts';

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

/* The line About leads with. The detail is empty where the headline says it all. */
export const describeUpdate = (state: UpdateState): { headline: string; detail: string } => {
    switch (state.status) {
        case 'unsupported':
            return {
                headline: 'Updates come from the desktop app',
                detail: ''
            };
        case 'checking':
            return { headline: 'Checking for updates', detail: '' };
        case 'available':
            return { headline: `Version ${state.version ?? 'unknown'} is available`, detail: '' };
        case 'downloading':
            return { headline: `Downloading ${state.version ?? 'the update'}`, detail: `${Math.round(state.percent ?? 0)}%` };
        case 'ready':
            return {
                headline: `Version ${state.version ?? 'unknown'} is ready`,
                detail: 'Ruimte restarts to install it. Nothing you have open is lost.'
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

// Not a setting: the settings store travels with everything that reads and writes preferences.
const SEEN_VERSION_KEY = 'ruimte.seenVersion';

export type VersionChange = 'first' | 'updated' | 'same' | 'older';

export const seenVersionChange = (seen: string | null, current: string): VersionChange => {
    if (seen === null || !isVersion(seen)) {
        return 'first';
    }
    const order = compareVersions(current, seen);
    return order > 0 ? 'updated' : order === 0 ? 'same' : 'older';
};

type SeenVersionStorage = Pick<Storage, 'getItem' | 'setItem'>;

const browserStorage = (): SeenVersionStorage | null => (typeof localStorage === 'undefined' ? null : localStorage);

/* One toast after an update. The version is written at once, so an ignored toast does not come back on the next start. */
export const noteVersionChange = (current: string, storage: SeenVersionStorage | null = browserStorage()): VersionChange => {
    let seen: string | null = null;
    try {
        seen = storage?.getItem(SEEN_VERSION_KEY) ?? null;
    } catch {
        return 'same';
    }
    const change = seenVersionChange(seen, current);
    if (change === 'same') {
        return change;
    }
    try {
        storage?.setItem(SEEN_VERSION_KEY, current);
    } catch {
        // Storage that refuses would show the toast on every start, so it shows none.
        return change;
    }
    if (change === 'updated') {
        setPreviousSeenVersion(seen);
        const withNotes = typeof desktop()?.releaseNotes === 'function';
        const id = useToasts.getState().show({
            id: 'updated-version',
            title: `Updated to version ${current}`,
            kind: 'success',
            persist: true,
            action: withNotes
                ? {
                      label: "What's new",
                      run: () => {
                          useToasts.getState().dismiss(id);
                          openReleaseNotes(current);
                      }
                  }
                : undefined
        });
    }
    return change;
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
        noteVersionChange(state.currentVersion);
        await setAutoDownload(autoDownload);
        await bridge.checkForUpdate?.();
    });
    return stop;
};
