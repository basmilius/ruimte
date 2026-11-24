import { lazyDialog } from '@adecore/ui';
import type { HostRef } from '@ruimte/contracts';
import { createDialogState } from '@/registry/dialog-state';
import type { DialogContribution } from '@/registry/dialogs';

interface IssueRequest {
    ref: HostRef;
    /* As the list or the link has it, shown until the issue itself was read. */
    title: string;
}

export const issueDialog = createDialogState<IssueRequest>();

const IssueDialog = lazyDialog(
    () => import('@/issues/IssueDialog'),
    'IssueDialog',
    issueDialog.store,
    (state) => state.request !== null
);

export const ISSUE_DIALOGS: readonly DialogContribution[] = [{ id: 'issue', surface: 'dialog', component: IssueDialog }];
