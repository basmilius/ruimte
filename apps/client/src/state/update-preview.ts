import type { UpdateState } from '@/desktop/bridge';
import { useReleaseNotes } from '@/state/release-notes';
import { useUpdates } from '@/state/updates';

export type UpdatePreview = 'off' | 'current' | 'available' | 'downloading' | 'ready' | 'error';

/*
 * Dev only: a checkout has no update feed, so About would never draw its update states. This puts a
 * made-up state in the store, on the newest release the shell's notes know, so the notes link and the
 * release date read as they would. No updater listens in a checkout, so nothing overwrites it.
 */
export const previewUpdate = (preview: UpdatePreview): void => {
    if (preview === 'off') {
        useUpdates.setState({ status: 'unsupported', currentVersion: '', version: undefined, percent: undefined, error: null, supported: false });
        return;
    }
    const releases = useReleaseNotes.getState().notes?.releases ?? [];
    const version = releases[0]?.version ?? '1.0.0';
    const currentVersion = preview === 'current' ? version : (releases[1]?.version ?? '0.9.0');
    const state: UpdateState = {
        status: preview,
        currentVersion,
        version: preview === 'current' ? undefined : version,
        percent: preview === 'downloading' ? 42 : undefined,
        error: preview === 'error' ? 'The update server could not be reached.' : null
    };
    useUpdates.setState({ ...state, supported: true });
};
