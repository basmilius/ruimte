import i18next from 'i18next';
import { formatPercent } from '@adecore/ui/format';
import { create } from 'zustand';
import { desktop, type UpdateState } from '@/desktop/bridge';
import { compareVersions, isVersion } from '@ruimte/desktop-bridge';
import { startMachineUpdate } from '@/state/machine-update';
import { openReleaseNotes, setPreviousSeenVersion } from '@/state/release-notes';
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

/* The green button in the toolbar. There is something to do, and one click leads to it. */
export function hasUpdate(state: UpdateState): boolean {
    return state.status === 'available' || state.status === 'downloading' || state.status === 'ready';
}

/* The line About leads with. The detail is empty where the headline says it all. */
export function describeUpdate(state: UpdateState): { headline: string; detail: string } {
    const version = state.version ?? i18next.t('state:update.unknownVersion');
    switch (state.status) {
        case 'unsupported':
            return { headline: i18next.t('state:update.unsupported'), detail: '' };
        case 'checking':
            return { headline: i18next.t('state:update.checking'), detail: '' };
        case 'available':
            return { headline: i18next.t('state:update.available', { version }), detail: '' };
        case 'downloading':
            return {
                headline: i18next.t('state:update.downloading', { version: state.version ?? i18next.t('state:update.theUpdate') }),
                detail: formatPercent(Math.round(state.percent ?? 0))
            };
        case 'ready':
            return { headline: i18next.t('state:update.ready', { version }), detail: i18next.t('state:update.readyDetail') };
        case 'error':
            return { headline: i18next.t('state:update.failed'), detail: state.error ?? i18next.t('state:update.failedDetail') };
        default:
            return { headline: i18next.t('state:update.current'), detail: '' };
    }
}

function apply(state: UpdateState): void {
    return useUpdates.setState({ ...state, supported: state.status !== 'unsupported' });
}

/* Whether the shell downloads on its own. Pushed again whenever the setting changes. */
export async function setAutoDownload(autoDownload: boolean): Promise<void> {
    await desktop()?.configureUpdates?.(autoDownload);
}

// Not a setting. The settings store travels with everything that reads and writes preferences.
const SEEN_VERSION_KEY = 'ruimte.seenVersion';

export type VersionChange = 'first' | 'updated' | 'same' | 'older';

export function seenVersionChange(seen: string | null, current: string): VersionChange {
    if (seen === null || !isVersion(seen)) {
        return 'first';
    }
    const order = compareVersions(current, seen);
    return order > 0 ? 'updated' : order === 0 ? 'same' : 'older';
}

type SeenVersionStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): SeenVersionStorage | null {
    return typeof localStorage === 'undefined' ? null : localStorage;
}

/* One toast after an update. The version is written at once, so an ignored toast does not come back on the next start. */
export function noteVersionChange(current: string, storage: SeenVersionStorage | null = browserStorage()): VersionChange {
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
            title: i18next.t('state:update.updated.title', { version: current }),
            kind: 'success',
            persist: true,
            action: withNotes
                ? {
                      label: i18next.t('state:update.updated.whatsNew'),
                      run: () => {
                          useToasts.getState().dismiss(id);
                          openReleaseNotes(current);
                      }
                  }
                : undefined
        });
    }
    return change;
}

/*
 * Wires the store to the shell. The state it already has and every change after it. The first check
 * waits until the auto-download preference has landed, so nothing downloads behind the back of
 * someone who turned it off. This computer's machine hears every step, so another client sees the
 * update and can ask for it. Returns the unsubscribe, or null where there is no shell to talk to.
 */
export function startUpdates(autoDownload: boolean): (() => void) | null {
    const bridge = desktop();
    if (!bridge?.updateState || !bridge.onUpdateState) {
        return null;
    }
    const machine = startMachineUpdate({
        state: () => useUpdates.getState(),
        download: () => useUpdates.getState().download(),
        install: () => bridge.installUpdate?.(true)
    });
    const follow = (state: UpdateState): void => {
        apply(state);
        machine.apply(state);
    };
    const stopShell = bridge.onUpdateState(follow);
    const stop = (): void => {
        stopShell();
        machine.stop();
    };
    void bridge.updateState().then(async (state) => {
        follow(state);
        if (state.status === 'unsupported') {
            return;
        }
        noteVersionChange(state.currentVersion);
        await setAutoDownload(autoDownload);
        await bridge.checkForUpdate?.();
    });
    return stop;
}
