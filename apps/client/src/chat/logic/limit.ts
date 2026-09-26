import i18next from 'i18next';
import type { ChatInfo } from '@ruimte/contracts';
import { formatMoment } from '@ruimte/ui/format/datetime';

export interface LimitView {
    /* The state in a word or two with its time, for a pill in a header. */
    pill: string;
    title: string;
    /* When it goes on, or what a person can do; null when the CLI named no time and nothing is owed. */
    detail: string | null;
}

/*
 * What a chat that stopped on a limit says about it, from its info alone, so a header that never holds
 * the thread says the same as the chat. Null while the last turn stopped on nothing, or a turn runs.
 */
export const limitView = (info: Pick<ChatInfo, 'limit' | 'resumeAt' | 'activeTurnId'>, now: number): LimitView | null => {
    const limit = info.limit;
    if (limit === undefined || info.activeTurnId !== null) {
        return null;
    }
    const resumes = info.resumeAt === undefined ? null : formatMoment(info.resumeAt, now);
    if (limit.kind === 'overload') {
        return {
            pill: resumes === null ? i18next.t('chat:limit.overload.pill') : i18next.t('chat:limit.overload.pillRetry', { time: resumes }),
            title: i18next.t('chat:limit.overload.title'),
            detail: resumes === null ? i18next.t('chat:limit.overload.sendAgain') : i18next.t('chat:limit.overload.retries', { time: resumes })
        };
    }
    const resets = limit.resetsAt === undefined ? null : formatMoment(limit.resetsAt, now);
    return {
        pill:
            resumes !== null
                ? i18next.t('chat:limit.usage.pillResumes', { time: resumes })
                : resets !== null
                  ? i18next.t('chat:limit.usage.pillUntil', { time: resets })
                  : i18next.t('chat:limit.usage.pill'),
        title: i18next.t('chat:limit.usage.title'),
        detail:
            resumes !== null
                ? i18next.t('chat:limit.usage.resumes', { time: resumes })
                : resets !== null
                  ? i18next.t('chat:limit.usage.resets', { time: resets })
                  : null
    };
};
