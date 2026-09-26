import { CircleCheck, CircleSlash, CircleX, Hourglass, LoaderCircle, type LucideIcon } from 'lucide-react';

/* The states a piece of work settles into, wherever it is drawn. */
export type StatusWord = 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

export interface StatusLook {
    icon: LucideIcon;
    tone: string;
    spins: boolean;
}

/*
 * One state, one mark: an entry in the sub-agent flyout, a task on its node (`TaskMark`), what finished
 * in the toolbar (`StatusSummary`) and work in progress in a toast. A spinner stops under reduced
 * motion with every other animation (`styles.css`).
 */
const LOOKS: Record<StatusWord, StatusLook> = {
    running: { icon: LoaderCircle, tone: 'text-status-running', spins: true },
    // The hourglass of a chat that stopped on a limit, since that is what holds the work up.
    paused: { icon: Hourglass, tone: 'text-text-faint', spins: false },
    done: { icon: CircleCheck, tone: 'text-status-idle', spins: false },
    failed: { icon: CircleX, tone: 'text-status-error', spins: false },
    cancelled: { icon: CircleSlash, tone: 'text-text-faint', spins: false }
};

export const statusLookOf = (word: StatusWord): StatusLook => LOOKS[word];

/* A task as far as its look goes, for an app that hands work to agents as tasks. */
export interface TaskState {
    status: 'open' | 'done' | 'failed' | 'cancelled';
    /* Set while the child waits out a limit. */
    paused?: object;
}

/* A task calls its running state `open`, which is the host's word for it and not a person's; an open task whose child stopped on a limit is paused. */
export const taskStatusWord = (task: TaskState): StatusWord => {
    if (task.status !== 'open') {
        return task.status;
    }
    return task.paused === undefined ? 'running' : 'paused';
};
