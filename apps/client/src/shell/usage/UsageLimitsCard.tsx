import { useState, type ReactElement } from 'react';
import clsx from 'clsx';
import { PreviewCard } from '@base-ui-components/react/preview-card';
import { useUi } from '@/state/ui';
import { SECTION_LABEL } from '@/ui/classes';
import { LimitsList } from '@/shell/usage/LimitsList';
import { useMinute, useUsageLimits } from '@/shell/usage/limits';

/* Asking the CLIs starts a process each, so the question waits until the card is actually opened. */
function CardBody() {
    const limits = useUsageLimits();
    const now = useMinute();

    if (limits === null) {
        return <p className="text-xs text-text-faint">Loading limits...</p>;
    }
    return <LimitsList limits={limits} now={now} compact />;
}

/*
 * What is left of each plan, without opening the usage page. A hover card rather than a tooltip:
 * the bars take a moment to read, and it stays open while the pointer travels to it.
 */
export function UsageLimitsCard({ children }: { children: ReactElement<Record<string, unknown>> }) {
    const [opened, setOpened] = useState(false);
    const onPage = useUi((s) => s.page === 'usage');

    // The page below already shows the same bars, and larger.
    if (onPage) {
        return children;
    }
    return (
        <PreviewCard.Root onOpenChange={(open) => open && setOpened(true)}>
            <PreviewCard.Trigger render={children} delay={500} />
            <PreviewCard.Portal>
                <PreviewCard.Positioner side="top" align="end" sideOffset={8} className="z-(--z-popup)">
                    <PreviewCard.Popup className="menu-popup w-64 p-3">
                        <h2 className={clsx(SECTION_LABEL, 'mb-3 block')}>Limits</h2>
                        {opened && <CardBody />}
                    </PreviewCard.Popup>
                </PreviewCard.Positioner>
            </PreviewCard.Portal>
        </PreviewCard.Root>
    );
}
