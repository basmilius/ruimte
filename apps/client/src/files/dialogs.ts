import { lazyDialog } from '@adecore/ui';
import { DiscardEditsDialog } from '@/files/DiscardEditsDialog';
import { UnsavedCloseDialog } from '@/files/UnsavedCloseDialog';
import type { DialogContribution } from '@/registry/dialogs';
import { useFileChoice } from '@/surface/panels/file-links';

const FileChoiceDialog = lazyDialog(
    () => import('@/files/FileChoiceDialog'),
    'FileChoiceDialog',
    useFileChoice,
    (s) => s.choice !== null
);

export const FILE_DIALOGS: readonly DialogContribution[] = [
    { id: 'unsaved-close', surface: 'dialog', component: UnsavedCloseDialog },
    { id: 'discard-edits', surface: 'dialog', component: DiscardEditsDialog },
    { id: 'file-choice', surface: 'dialog', component: FileChoiceDialog }
];
