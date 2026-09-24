import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { Task } from '@ruimte/contracts';
import { Icon } from '@/ui/Icon';
import { statusLookOf, taskStatusWord } from '@/ui/status-look';
import { Tooltip } from '@/ui/Tooltip';

/*
 * The mark a node wears when another agent opened it with a task: the line into it says so on the
 * canvas, but below a readable zoom the line's word is gone, so the node carries it as well. Nothing
 * to press; the row in the thread of the chat that gave the task is where its result is read.
 */
export function TaskMark({ task, className }: { task: Task; className?: string }) {
    const { t } = useTranslation('common');
    const word = taskStatusWord(task);
    const look = statusLookOf(word);
    return (
        <Tooltip label={t('taskMark', { title: task.title, status: t(`status.${word}`) })}>
            <span className={clsx('inline-flex shrink-0 items-center', look.tone, className)}>
                <Icon icon={look.icon} size={12} className={clsx(look.spins && 'animate-spin')} />
            </span>
        </Tooltip>
    );
}
