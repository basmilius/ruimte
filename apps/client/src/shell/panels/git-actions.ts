import type { GitActionKind, GitActionPhase, GitStatus } from '@ruimte/contracts';

export interface PushButton {
    label: string;
    kind: GitActionKind;
    disabled: boolean;
    /* What the tooltip says, which on a disabled button is why it is one. */
    reason: string;
}

/*
 * The primary button of the header. A branch git has never seen is published with an upstream in
 * the same push, which is a different word for the person and a different flag for git, so the
 * button says which of the two it is instead of failing halfway.
 */
export const pushButton = (status: GitStatus | null): PushButton => {
    if (status === null || !status.repo) {
        return { label: 'Push', kind: 'push', disabled: true, reason: 'No repository' };
    }
    if (status.detached || status.branch === null) {
        return { label: 'Push', kind: 'push', disabled: true, reason: 'No branch to push on a detached HEAD' };
    }
    if (status.upstream === null) {
        return { label: 'Publish branch', kind: 'publish', disabled: false, reason: `Push ${status.branch} to origin and track it` };
    }
    if (status.ahead === 0) {
        return { label: 'Push', kind: 'push', disabled: true, reason: 'Nothing to push' };
    }
    const commits = status.ahead === 1 ? '1 commit' : `${status.ahead} commits`;
    return { label: 'Push', kind: 'push', disabled: false, reason: `Push ${commits} to ${status.upstream}` };
};

const PHASE_LABEL: Record<GitActionPhase, string> = {
    start: 'Starting',
    fetch: 'Fetching',
    stage: 'Staging',
    commit: 'Committing',
    push: 'Pushing',
    pull: 'Pulling',
    branch: 'Switching branch',
    stash: 'Stashing',
    merge: 'Merging',
    rebase: 'Rebasing',
    pr: 'Opening the pull request',
    done: 'Done',
    failed: 'That did not work'
};

/* The title of the toast while an action runs: where it is, in the words a person would use. */
export const phaseLabel = (phase: GitActionPhase): string => PHASE_LABEL[phase];

const ACTION_TITLE: Partial<Record<GitActionKind, string>> = {
    fetch: 'Fetching',
    pull: 'Pulling',
    push: 'Pushing',
    publish: 'Publishing the branch',
    'force-push': 'Force pushing',
    sync: 'Syncing',
    checkout: 'Switching branch',
    'create-branch': 'Creating the branch',
    'rename-branch': 'Renaming the branch',
    'delete-branch': 'Deleting the branch',
    merge: 'Merging',
    rebase: 'Rebasing',
    stash: 'Stashing',
    'stash-pop': 'Popping the stash',
    commit: 'Committing',
    'commit-push': 'Committing and pushing',
    'create-pr': 'Opening the pull request'
};

/* What the toast says the moment an action starts, before git has written a line. */
export const actionTitle = (kind: GitActionKind): string => ACTION_TITLE[kind] ?? 'Working';

/* The first line is the subject and the rest is the body, the way git itself reads a message. */
export const splitMessage = (message: string): { subject: string; body: string } => {
    const [subject = '', ...rest] = message.split('\n');
    return { subject: subject.trim(), body: rest.join('\n').trim() };
};

/* Git refuses to delete a branch it has not merged anywhere; only that refusal earns a second ask. */
export const isUnmergedRefusal = (message: string): boolean => message.includes('not fully merged');
