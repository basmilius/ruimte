import { Tooltip } from '@adecore/ui';
import type { AgentStatus } from '@ruimte/contracts';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

const STATUS_CLASS: Record<AgentStatus, string> = {
    running: 'bg-status-running',
    'needs-you': 'bg-status-needs-you',
    idle: 'bg-status-idle',
    error: 'bg-status-error',
    // A CLI that is gone is not a failure; it is a session waiting to be picked up again.
    exited: 'bg-text-faint'
};

/* `plain` drops the tooltip, for a control that already has one of its own; a screen reader still hears the status. */
export function StatusDot({ status, className, plain = false }: { status: AgentStatus; className?: string; plain?: boolean }) {
    const { t } = useTranslation('canvas');
    const label = t(`status.${status}`);
    const dot = (
        <span
            role="img"
            aria-label={label}
            className={clsx('inline-block h-2 w-2 shrink-0 rounded-full', STATUS_CLASS[status], status === 'running' && 'status-pulse', className)}
        />
    );
    if (plain) {
        return dot;
    }
    return <Tooltip label={label}>{dot}</Tooltip>;
}
