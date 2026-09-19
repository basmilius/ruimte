import i18next from 'i18next';
import clsx from 'clsx';
import { TriangleAlert } from 'lucide-react';
import type { ProcessAlert } from '@ruimte/contracts';
import { alertText } from '@/processes/format';
import { useProcessAlerts } from '@/state/processes';
import { useEndpointId } from '@/state/keys';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/* The warnings about one node, for the mark on its header and on its sidebar row. */
export const useNodeAlerts = (nodeId: string): ProcessAlert[] => {
    const alerts = useProcessAlerts(useEndpointId());
    return alerts.filter((alert) => alert.nodeId === nodeId);
};

/*
 * The mark a node with a process warning wears. It opens the processes panel, where the warning
 * says the rest and carries its button; the mark itself never acts on a process.
 */
export function ProcessAlertMark({ alerts, className }: { alerts: readonly ProcessAlert[]; className?: string }) {
    const first = alerts[0];
    if (first === undefined) {
        return null;
    }
    const text = alertText(first, Date.now());
    const label = alerts.length === 1 ? text : i18next.t('processes:alert.more', { count: alerts.length - 1, text });
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
