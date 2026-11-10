import { lazyDialog } from '@adecore/ui';
import { LeaveConflictDialog } from '@/conflicts/LeaveConflictDialog';
import type { DialogContribution } from '@/registry/dialogs';
import { conflictsDialog } from '@/worktrees/dialogs';

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
