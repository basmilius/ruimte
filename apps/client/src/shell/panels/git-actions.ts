import i18next from 'i18next';
import type { GitActionKind, GitActionPhase, GitStatus } from '@ruimte/contracts';

let counter = 0;

/* Names one run, so the progress of this push is not drawn on the toast of the one before it. */
export const nextActionId = (): string => {
    counter += 1;
    return `git-${Date.now()}-${counter}`;
};

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
    const push = i18next.t('panels:git.push.label');
    if (status === null || !status.repo) {
        return { label: push, kind: 'push', disabled: true, reason: i18next.t('panels:git.push.noRepo') };
    }
    if (status.detached || status.branch === null) {
        return { label: push, kind: 'push', disabled: true, reason: i18next.t('panels:git.push.detached') };
    }
    if (status.upstream === null) {
        return {
            label: i18next.t('panels:git.push.publish'),
            kind: 'publish',
            disabled: false,
            reason: i18next.t('panels:git.push.publishReason', { branch: status.branch })
        };
    }
    if (status.ahead === 0) {
        return { label: push, kind: 'push', disabled: true, reason: i18next.t('panels:git.push.nothing') };
    }
    return { label: push, kind: 'push', disabled: false, reason: i18next.t('panels:git.push.reason', { count: status.ahead, upstream: status.upstream }) };
};

/* What the push menu offers for one repository: what its own button would say and how far ahead it is. */
export interface PushEntry {
    cwd: string;
    label: string;
    button: PushButton;
    ahead: number;
}

export const pushEntries = (checkouts: readonly { path: string; label: string; status: GitStatus | null }[]): PushEntry[] =>
    checkouts.map((checkout) => ({
        cwd: checkout.path,
        label: checkout.label,
        button: pushButton(checkout.status),
        ahead: checkout.status?.ahead ?? 0
    }));

/* The repositories a push would actually move, which is what "push all" runs and counts. */
export const pushable = (entries: readonly PushEntry[]): PushEntry[] => entries.filter((entry) => !entry.button.disabled);

/*
 * The primary button while the folder holds more than one repository. It pushes all of them: pushing
 * one of nine is the exception, and the flyout beside it is where that one is. Nothing to push
 * anywhere disables the button and the flyout with it, since every row in there would be dead too.
 */
export const pushAllButton = (entries: readonly PushEntry[]): PushButton => {
    const ready = pushable(entries);
    return {
        label: i18next.t('panels:git.push.allLabel'),
        kind: 'push',
        disabled: ready.length === 0,
        reason: ready.length === 0 ? i18next.t('panels:git.push.nothing') : i18next.t('panels:git.push.allReason', { count: ready.length })
    };
};

/* What the toast says while a run over several repositories is on this one. A kind this version has
   no words for still counts its way through rather than showing the name of a missing key. */
export const manyTitle = (kind: GitActionKind, repo: string, done: number, total: number): string =>
    i18next.t(`panels:git.many.${kind}`, { repo, done, total, defaultValue: i18next.t('panels:git.many.working', { repo, done, total }) });

/* What it says once that run is over. A repository that failed does not stop the others, so the end
   is the only place the whole outcome can be read. */
export const manySummary = (done: number, failed: readonly string[]): string =>
    failed.length === 0
        ? i18next.t('panels:git.many.done', { count: done })
        : i18next.t('panels:git.many.failed', { count: failed.length, repos: failed.join(', ') });

/* One checkout as the commit box weighs it: what is staged in it decides whether it takes the commit. */
export interface CommitCandidate {
    path: string;
    label: string;
    status: GitStatus | null;
}

/*
 * Where a commit would land. Every repository with something staged takes it, which is how a person
 * says with the files themselves what belongs in one commit. Nothing staged anywhere and exactly one
 * repository with changes is the commit that stages that repository first, the way it always was;
 * with more than one, staging is what has to say which of them is meant, so there is nothing to
 * commit yet.
 */
export const commitTargets = (checkouts: readonly CommitCandidate[]): { targets: CommitCandidate[]; stageAll: boolean } => {
    const staged = checkouts.filter((checkout) => checkout.status?.files.some((file) => file.state === 'staged') === true);
    if (staged.length > 0) {
        return { targets: staged, stageAll: false };
    }
    const changed = checkouts.filter((checkout) => (checkout.status?.files.length ?? 0) > 0);
    return changed.length === 1 ? { targets: changed, stageAll: true } : { targets: [], stageAll: false };
};

/* The title of the toast while an action runs: where it is, in the words a person would use. */
export const phaseLabel = (phase: GitActionPhase): string => i18next.t(`panels:git.phase.${phase}`);

/* What the toast says the moment an action starts, before git has written a line. A kind this
   version has no words for still gets a title rather than the name of a missing key. */
export const actionTitle = (kind: GitActionKind): string => i18next.t(`panels:git.action.${kind}`, { defaultValue: i18next.t('panels:git.action.working') });

/* The first line is the subject and the rest is the body, the way git itself reads a message. */
export const splitMessage = (message: string): { subject: string; body: string } => {
    const [subject = '', ...rest] = message.split('\n');
    return { subject: subject.trim(), body: rest.join('\n').trim() };
};

/* Git refuses to delete a branch it has not merged anywhere; only that refusal earns a second ask. */
export const isUnmergedRefusal = (message: string): boolean => message.includes('not fully merged');
