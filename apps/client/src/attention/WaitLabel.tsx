import { useTranslation } from 'react-i18next';
import { Hand, Hourglass, MessageCircleQuestion } from 'lucide-react';
import { Icon, Pill, Tooltip, useNow } from '@adecore/ui';
import { formatAgo, formatDuration, formatElapsedShort, formatNumber, useFormatLocale } from '@adecore/ui/format';
import type { WaitDetails } from '@/state/waiting';

const LONG_WAIT_MS = 10 * 60_000;

const KIND_ICONS = {
    approval: Hand,
    question: MessageCircleQuestion,
    waiting: Hourglass
};

export function WaitAge({ since, quiet = false }: { since: number; quiet?: boolean }) {
    'use no memo';
    const { t } = useTranslation('shell');
    const now = useNow(30_000);
    useFormatLocale();

    const date = new Date(since);

    if (since <= 0 || !Number.isFinite(date.getTime())) {
        return null;
    }

    const elapsed = Math.max(0, now - since);
    const long = elapsed >= LONG_WAIT_MS;
    const spoken = elapsed < 60_000 ? t('attention.underMinute', { minute: formatNumber(1) }) : formatDuration(Math.floor(elapsed / 60_000) * 60_000);
    const unit = elapsed < 3_600_000 ? 60_000 : 3_600_000;
    const shown = elapsed < 60_000 ? formatAgo(0) : formatElapsedShort(Math.floor(elapsed / unit) * unit);

    return (
        <time
            dateTime={date.toISOString()}
            className={long && !quiet ? 'whitespace-nowrap tabular-nums text-status-needs-you' : 'whitespace-nowrap tabular-nums'}
            aria-label={t(long ? 'attention.longWait' : 'attention.waitAge', { age: spoken })}
        >
            {shown}
        </time>
    );
}

export function WaitLabel({ detail, snoozed = false }: { detail?: WaitDetails; snoozed?: boolean }) {
    const { t } = useTranslation('shell');
    const kind = detail?.kind ?? 'waiting';
    const label = t(`attention.kind.${kind}`);

    return (
        <Tooltip label={label}>
            <span className="inline-flex shrink-0">
                <Pill size="sm" tone={snoozed ? 'muted' : 'needsYou'} icon={<Icon icon={KIND_ICONS[kind]} size={12} />}>
                    <span className="sr-only">{label}</span>
                    {detail && <WaitAge since={detail.since} quiet={snoozed} />}
                </Pill>
            </span>
        </Tooltip>
    );
}
