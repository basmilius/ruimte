import clsx from 'clsx';
import { Tooltip } from '@/ui/Tooltip';
import { useTransportStatus } from '@/transport/status';
import type { TransportStatus } from '@/transport';

const STYLE: Record<TransportStatus, { color: string; label: string }> = {
    open: { color: 'bg-status-idle', label: 'Connected to the server' },
    connecting: {
        color: 'bg-status-needs-you',
        label: 'Connecting to the server'
    },
    closed: { color: 'bg-status-error', label: 'Disconnected from the server' }
};

export function ConnectionDot() {
    const status = useTransportStatus();
    const { color, label } = STYLE[status];
    return (
        <Tooltip label={label}>
            <span className="grid h-8 w-5 shrink-0 place-items-center" role="status" aria-label={label}>
                <span className={clsx('h-2 w-2 rounded-full', color)} />
            </span>
        </Tooltip>
    );
}
