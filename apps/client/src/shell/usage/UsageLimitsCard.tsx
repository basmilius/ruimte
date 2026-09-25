import i18next from 'i18next';
import { useState, type ReactElement } from 'react';
import { PreviewCard } from '@base-ui-components/react/preview-card';
import { hasSeveralAccounts } from '@/shell/usage/limit-groups';
import { AccountLimitsList, LimitsList } from '@/shell/usage/LimitsList';
import { useLimitGroups, useMinute, useUsageLimits } from '@/shell/usage/limits';

/* Asking the CLIs starts a process each, so the question waits until the card is actually opened. */
function CardBody() {
    const limits = useUsageLimits();
    const groups = useLimitGroups(limits);
    const now = useMinute();

    if (limits === null) {
        return <p className="text-xs text-text-faint">{i18next.t('usage:limits.loading')}</p>;
    }
    return hasSeveralAccounts(groups) ? <AccountLimitsList groups={groups} now={now} /> : <LimitsList limits={limits} now={now} compact />;
}

/*
 * What is left of each plan, without opening the usage dialog. A hover card rather than a tooltip:
 * the bars take a moment to read, and it stays open while the pointer travels to it.
 */
export function UsageLimitsCard({ children }: { children: ReactElement<Record<string, unknown>> }) {
    const [opened, setOpened] = useState(false);
    return (
        <PreviewCard.Root onOpenChange={(open) => open && setOpened(true)}>
            <PreviewCard.Trigger render={children} delay={500} />
            <PreviewCard.Portal>
                <PreviewCard.Positioner side="top" align="end" sideOffset={8} className="z-(--z-popup)">
                    <PreviewCard.Popup className="menu-popup w-64 p-3">{opened && <CardBody />}</PreviewCard.Popup>
                </PreviewCard.Positioner>
            </PreviewCard.Portal>
        </PreviewCard.Root>
    );
}
