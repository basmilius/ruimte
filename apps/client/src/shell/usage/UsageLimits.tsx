import { useTranslation } from 'react-i18next';
import { SECTION_LABEL } from '@/ui/classes';
import { LimitsList } from '@/shell/usage/LimitsList';
import { useMinute, useUsageLimits } from '@/shell/usage/limits';

/*
 * What is left of each plan, asked of the CLIs themselves. Nothing here reads a credential: both
 * CLIs hold their own login and answer the question when the daemon starts one and asks.
 */
export function UsageLimits() {
    const { t } = useTranslation('usage');
    const limits = useUsageLimits();
    const now = useMinute();

    if (limits === null) {
        return null;
    }
    return (
        <section className="flex flex-col gap-3">
            <h2 className={SECTION_LABEL}>{t('limits.title')}</h2>
            <p className="text-xs text-text-muted">{t('limits.explain')}</p>
            <LimitsList limits={limits} now={now} />
        </section>
    );
}
