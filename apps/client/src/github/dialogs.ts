import { lazyDialog } from '@adecore/ui';
import { createDialogState, createFlagState } from '@/registry/dialog-state';
import type { DialogContribution } from '@/registry/dialogs';

/* The dialog that starts a chat on a GitHub issue. */
export const issueStartDialog = createFlagState();

/* The checkout whose pull request is shown, while that dialog is up. */
export const pullRequestDialog = createDialogState<{ cwd: string }>();

const IssueStartDialog = lazyDialog(
    () => import('@/github/IssueStartDialog'),
    'IssueStartDialog',
    issueStartDialog.store,
    (state) => state.open
);
const PullRequestDialog = lazyDialog(
    () => import('@/github/PullRequestDialog'),
    'PullRequestDialog',
    pullRequestDialog.store,
    (state) => state.request !== null
);

export const GITHUB_DIALOGS: readonly DialogContribution[] = [
    { id: 'issue-start', surface: 'dialog', component: IssueStartDialog },
    { id: 'pull-request', surface: 'dialog', component: PullRequestDialog }
];
