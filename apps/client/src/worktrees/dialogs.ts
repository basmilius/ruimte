import { lazyDialog } from '@adecore/ui';
import { createDialogState, createFlagState } from '@/registry/dialog-state';
import type { DialogContribution } from '@/registry/dialogs';
import { MergeWorktreeDialog } from '@/worktrees/MergeWorktreeDialog';
import { RemoveWorktreeDialog } from '@/worktrees/RemoveWorktreeDialog';
import { WorktreeDialog } from '@/worktrees/WorktreeDialog';

export interface WorktreeMergeRequest {
    /* The project folder whose repository holds the worktrees. */
    folder: string;
    /* In the order they are merged; a group's are in the order of its members. */
    paths: string[];
    /* Whether "remove afterwards" starts ticked; removing a worktree with work asks to merge first with it on. */
    remove?: boolean;
}

export const worktreeBindDialog = createDialogState<string>();

export const worktreeRemovalDialog = createDialogState<{ folder: string; paths: string[] }>();

export const worktreeMergeDialog = createDialogState<WorktreeMergeRequest>();

export const newWorktreeChatDialog = createFlagState();

const NewWorktreeChatDialog = lazyDialog(
    () => import('@/worktrees/NewWorktreeChatDialog'),
    'NewWorktreeChatDialog',
    newWorktreeChatDialog.store,
    (state) => state.open
);

export const WORKTREE_DIALOGS: readonly DialogContribution[] = [
    { id: 'worktree-bind', surface: 'dialog', component: WorktreeDialog },
    { id: 'worktree-remove', surface: 'dialog', component: RemoveWorktreeDialog },
    { id: 'worktree-merge', surface: 'dialog', component: MergeWorktreeDialog },
    { id: 'worktree-new-chat', surface: 'dialog', component: NewWorktreeChatDialog }
];

interface ConflictRequest {
    cwd: string;
    path?: string;
}

/* The checkout whose conflicts are open in the overlay; null while it is closed. A merge that stops on conflicts opens it, so it sits beside the merge. */
export const conflictsDialog = createDialogState<ConflictRequest>();
