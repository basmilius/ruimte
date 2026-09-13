import clsx from 'clsx';
import { CircleCheck } from 'lucide-react';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/*
 * The mark a node wears when its turn ended while nobody was looking. The glyph and the color of the
 * finished count in the toolbar (`shell/StatusSummary.tsx`), so one fact wears one face wherever it
 * is drawn, and deliberately not the warning the stuck-agent mark wears: a turn that finished is
 * good news. Nothing to press either, unlike `ProcessAlertMark`, whose warning has a panel behind
 * it: looking at the node is what takes this one off, so a button would be a second answer to a
 * question the camera already answers.
 */
export function UnseenMark({ className }: { className?: string }) {
    return (
        <Tooltip label="Finished while you were away">
            <span className={clsx('inline-flex shrink-0 items-center text-status-idle', className)}>
                <Icon icon={CircleCheck} size={12} />
            </span>
        </Tooltip>
    );
}
