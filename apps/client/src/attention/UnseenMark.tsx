import clsx from 'clsx';
import { CircleCheck } from 'lucide-react';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

// The camera clears unseen state, so this mark is not another button for the same action.
export function UnseenMark({ className }: { className?: string }) {
    return (
        <Tooltip label="Finished while you were away">
            <span className={clsx('inline-flex shrink-0 items-center text-status-idle', className)}>
                <Icon icon={CircleCheck} size={12} />
            </span>
        </Tooltip>
    );
}
