import i18next from 'i18next';
import clsx from 'clsx';
import { TriangleAlert } from 'lucide-react';
import type { ProcessAlert } from '@ruimte/contracts';
import { alertText } from '@/processes/format';
import { useUi } from '@/state/ui';
import { Icon } from '@ruimte/ui/Icon';
import { Tooltip } from '@ruimte/ui/Tooltip';
import { useNow } from '@ruimte/ui/useNow';

const MINUTE_MS = 60_000;

/*
 * The mark a node with a process warning wears. It opens the processes panel, where the warning
 * says the rest and carries its button; the mark itself never acts on a process.
 */
export function ProcessAlertMark({ alerts, className }: { alerts: readonly ProcessAlert[]; className?: string }) {
    const first = alerts[0];
    if (first === undefined) {
        return null;
    }
    return <AlertMark first={first} count={alerts.length} className={className} />;
}

/* Only a node with a warning keeps a clock, which moves the elapsed time in its label once a minute. */
function AlertMark({ first, count, className }: { first: ProcessAlert; count: number; className?: string }) {
    const now = useNow(MINUTE_MS);
    const text = alertText(first, now);
    const label = count === 1 ? text : i18next.t('processes:alert.more', { count: count - 1, text });
    return (
        <Tooltip label={label} name>
            <span
                role="button"
                tabIndex={-1}
                className={clsx('inline-flex shrink-0 items-center text-status-needs-you', className)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                    e.stopPropagation();
                    useUi.getState().setPanel({ open: true, kind: 'processes' });
                }}
            >
                <Icon icon={TriangleAlert} size={12} />
            </span>
        </Tooltip>
    );
}
