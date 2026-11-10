import { lazyDialog } from '@adecore/ui';
import type { DialogContribution } from '@/registry/dialogs';
import { useReleaseNotes } from '@/state/release-notes';

const ReleaseNotesDialog = lazyDialog(
    () => import('@/release-notes/ReleaseNotesDialog'),
    'ReleaseNotesDialog',
    useReleaseNotes,
    (s) => s.open
);

export const RELEASE_NOTES_DIALOGS: readonly DialogContribution[] = [{ id: 'release-notes', surface: null, component: ReleaseNotesDialog }];
