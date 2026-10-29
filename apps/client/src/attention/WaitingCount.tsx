import { useTranslation } from 'react-i18next';
import { formatNumber, useFormatLocale } from '@adecore/ui/format';

export function WaitingCount({ count }: { count: number }) {
    const { t } = useTranslation('shell');
    useFormatLocale();

    if (count === 0) {
        return null;
    }

    return (
        <span className="shrink-0 text-xs tabular-nums text-status-needs-you" aria-label={t('sidebar.waitingCount', { count })}>
            {formatNumber(count)}
        </span>
    );
}
