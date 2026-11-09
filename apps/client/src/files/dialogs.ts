import { lazyDialog } from '@adecore/ui';
import { useBranchCompare } from '@/files/branch-compare';
import { DiscardEditsDialog } from '@/files/DiscardEditsDialog';
import { UnsavedCloseDialog } from '@/files/UnsavedCloseDialog';
import type { DialogContribution } from '@/registry/dialogs';
import { useFileChoice } from '@/surface/panels/file-links';

const BranchCompareDialog = lazyDialog(
    () => import('@/files/BranchCompareDialog'),
    'BranchCompareDialog',
    useBranchCompare,
    (s) => s.request !== null
);

const FileChoiceDialog = lazyDialog(
    () => import('@/files/FileChoiceDialog'),
    'FileChoiceDialog',
    useFileChoice,
    (s) => s.choice !== null
);

export const FILE_DIALOGS: readonly DialogContribution[] = [
    { id: 'unsaved-close', surface: 'dialog', component: UnsavedCloseDialog },
    { id: 'discard-edits', surface: 'dialog', component: DiscardEditsDialog },
    { id: 'branch-compare', surface: 'dialog', component: BranchCompareDialog },
    { id: 'file-choice', surface: 'dialog', component: FileChoiceDialog }
];
