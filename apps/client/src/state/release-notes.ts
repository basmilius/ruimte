import i18next from 'i18next';
import { compareVersions, isVersion } from '@ruimte/desktop-bridge';
import { create } from 'zustand';
import { desktop, type Release, type ReleaseNotesState, type UpdateState } from '@/desktop/bridge';
import { hasUpdate } from '@/state/updates';

export const RELEASES_PAGE = 'https://github.com/basmilius/ruimte/releases';

interface ReleaseNotesStore {
    /* Null until the shell answered once. */
    notes: ReleaseNotesState | null;
    loading: boolean;
    open: boolean;
    /* The version the dialog was opened on, which it scrolls to. */
    version: string | null;
    /* The version this client ran before an update, for the "New" badges. Held for the session only. */
    previousSeen: string | null;
}

export const useReleaseNotes = create<ReleaseNotesStore>(() => ({
    notes: null,
    loading: false,
    open: false,
    version: null,
    previousSeen: null
}));

export const canShowReleaseNotes = (): boolean => typeof desktop()?.releaseNotes === 'function';

let pending: Promise<void> | null = null;
let running = 0;

export const loadReleaseNotes = (refresh: boolean): Promise<void> => {
    const bridge = desktop();
    if (!bridge?.releaseNotes) {
        return Promise.resolve();
    }
    const ask = bridge.releaseNotes.bind(bridge);
    // A refresh behind a plain read would answer with the list the read already had.
    const run = async (): Promise<void> => {
        // Before the first await, so a second `ensureReleaseNotes` in the same tick sees it.
        running += 1;
        useReleaseNotes.setState({ loading: true });
        await pending;
        try {
            useReleaseNotes.setState({ notes: await ask(refresh) });
        } catch (e) {
            const previous = useReleaseNotes.getState().notes;
            useReleaseNotes.setState({
                notes: {
                    releases: previous?.releases ?? [],
                    fetchedAt: previous?.fetchedAt ?? null,
                    error: e instanceof Error ? e.message : i18next.t('state:update.noAnswer')
                }
            });
        } finally {
            // A read that ends under a refresh still running must not flash "not available yet".
            running -= 1;
            useReleaseNotes.setState({ loading: running > 0 });
        }
    };
    const current = run();
    pending = current;
    return current;
};

/* The list from the shell's copy, once a session, for whether About has a link to show. */
export const ensureReleaseNotes = (): void => {
    const state = useReleaseNotes.getState();
    if (state.notes !== null || state.loading) {
        return;
    }
    void loadReleaseNotes(false);
};

/* Opening asks GitHub again, so a version the cached list does not know yet gets its one refetch. */
export const openReleaseNotes = (version: string | null): void => {
    useReleaseNotes.setState({ open: true, version });
    void loadReleaseNotes(true);
};

export const closeReleaseNotes = (): void => {
    useReleaseNotes.setState({ open: false });
};

export const setPreviousSeenVersion = (version: string | null): void => {
    useReleaseNotes.setState({ previousSeen: version });
};

export type NoteRole = 'upcoming' | 'installed' | 'older';

export interface NoteEntry {
    release: Release;
    role: NoteRole;
    /* What the version is to this machine: where the update stands, or that it runs. */
    badge: string | null;
    /* Above the version this client ran before the update it just had. */
    isNew: boolean;
}

export interface NotesView {
    entries: NoteEntry[];
    /* The link in About, with the version the dialog opens on. */
    link: { label: string; version: string } | null;
}

/* Read when a view is built rather than when this module loads, or the words would be the ones the
   app started in and never the ones a person switched to. */
const updateBadge = (status: UpdateState['status']): string | null => {
    switch (status) {
        case 'available':
        case 'downloading':
        case 'ready':
            return i18next.t(`state:badge.${status}`);
        default:
            return null;
    }
};

export const notesView = (releases: Release[], currentVersion: string, updateState: UpdateState, previousSeen: string | null): NotesView => {
    const update = hasUpdate(updateState) && updateState.version ? updateState.version : null;
    const entries = releases.map((release): NoteEntry => {
        const order = compareVersions(release.version, currentVersion);
        const role: NoteRole = order > 0 ? 'upcoming' : order === 0 ? 'installed' : 'older';
        let badge: string | null = null;
        if (role === 'installed') {
            badge = i18next.t('state:badge.installed');
        } else if (role === 'upcoming' && update !== null && compareVersions(release.version, update) <= 0) {
            badge = updateBadge(updateState.status);
        }
        const isNew = previousSeen !== null && isVersion(previousSeen) && compareVersions(release.version, previousSeen) > 0 && order <= 0;
        return { release, role, badge, isNew };
    });

    let link: NotesView['link'] = null;
    if (updateState.status !== 'unsupported') {
        if (update !== null) {
            // Always offered: a version the list does not know yet gets its refetch in the dialog.
            link = { label: `What's new in version ${update}`, version: update };
        } else if (releases.some((release) => release.version === currentVersion && release.body !== '')) {
            link = { label: "What's new", version: currentVersion };
        }
    }
    return { entries, link };
};

/* The line the dialog shows for a version it was opened on and cannot find, once asking again is over. */
export const missingNotesNotice = (releases: Release[], version: string | null, loading: boolean): { text: string; url: string } | null => {
    if (version === null || loading || releases.some((release) => release.version === version)) {
        return null;
    }
    return { text: `Notes for version ${version} are not available yet`, url: `${RELEASES_PAGE}/tag/v${version}` };
};
