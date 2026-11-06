import { lazyDialog } from '@adecore/ui';
import { LeaveConflictDialog } from '@/conflicts/LeaveConflictDialog';
import { createDialogState } from '@/registry/dialog-state';
import type { DialogContribution } from '@/registry/dialogs';

/* The checkout whose unmerged files are being resolved, and the file the overlay opens on. */
export interface ConflictRequest {
    cwd: string;
    path?: string;
}

/* The checkout whose conflicts are open in the overlay; null while it is closed. */
export const conflictsDialog = createDialogState<ConflictRequest>();

const ConflictOverlay = lazyDialog(
    () => import('@/conflicts/ConflictOverlay'),
    'ConflictOverlay',
    conflictsDialog.store,
    (state) => state.request !== null
);

export const CONFLICT_DIALOGS: readonly DialogContribution[] = [
    { id: 'conflict-leave', surface: 'dialog', component: LeaveConflictDialog },
    { id: 'conflicts', surface: 'conflicts', component: ConflictOverlay }
];
