import { useTranslation } from 'react-i18next';
import { useNow } from '@adecore/ui';
import { formatDuration, useFormatLocale } from '@adecore/ui/format';
import type { WaitDetails } from '@/state/waiting';

const LONG_WAIT_MS = 10 * 60_000;

export function WaitAge({ since }: { since: number }) {
    'use no memo';
    const { t } = useTranslation('shell');
    const now = useNow(30_000);
    useFormatLocale();

    const date = new Date(since);

    if (!Number.isFinite(date.getTime())) {
        return null;
    }

    const long = now - since >= LONG_WAIT_MS;
    const age = formatDuration(Math.max(0, now - since));

    return (
        <time
            dateTime={date.toISOString()}
            className={long ? 'whitespace-nowrap tabular-nums text-status-needs-you' : 'whitespace-nowrap tabular-nums'}
            aria-label={t(long ? 'attention.longWait' : 'attention.waitAge', { age })}
        >
            {age}
        </time>
    );
}

export function WaitLabel({ detail }: { detail?: WaitDetails }) {
    const { t } = useTranslation('shell');

    return (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-text-muted">
            <span>{t(`attention.kind.${detail?.kind ?? 'waiting'}`)}</span>
            {detail && <WaitAge since={detail.since} />}
        </span>
    );
}
