import clsx from 'clsx';
import { CircleDashed, CircleSlash, CircleX, ListChecks } from 'lucide-react';
import type { Task } from '@ruimte/contracts';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const LOOK: Record<Task['status'], { icon: typeof ListChecks; className: string; word: string }> = {
    open: { icon: CircleDashed, className: 'text-status-running', word: 'working on it' },
    done: { icon: ListChecks, className: 'text-status-idle', word: 'done' },
    failed: { icon: CircleX, className: 'text-status-error', word: 'failed' },
    cancelled: { icon: CircleSlash, className: 'text-text-faint', word: 'cancelled' }
};

/*
 * The mark a node wears when another agent opened it with a task: the line into it says so on the
 * canvas, but below a readable zoom the line's word is gone, so the node carries it as well. Nothing
 * to press; the row in the thread of the chat that gave the task is where its result is read.
 */
export function TaskMark({ task, className }: { task: Task; className?: string }) {
    const look = LOOK[task.status];
    return (
        <Tooltip label={`Task: ${task.title} (${look.word})`}>
            <span className={clsx('inline-flex shrink-0 items-center', look.className, className)}>
                <Icon icon={look.icon} size={12} />
            </span>
        </Tooltip>
    );
}
