import i18next from 'i18next';
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
