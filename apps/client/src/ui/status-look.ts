import { CircleCheck, CircleSlash, CircleX, LoaderCircle, type LucideIcon } from 'lucide-react';

/* The states a piece of work settles into, wherever it is drawn. */
export type StatusWord = 'running' | 'done' | 'failed' | 'cancelled';

export interface StatusLook {
    icon: LucideIcon;
    tone: string;
    spins: boolean;
}

/*
 * One state, one mark: an entry in the sub-agent list, a task on its node (`TaskMark`), what finished
 * in the toolbar (`StatusSummary`) and work in progress in a toast. A spinner stops under reduced
 * motion with every other animation (`styles.css`).
 */
const LOOKS: Record<StatusWord, StatusLook> = {
    running: { icon: LoaderCircle, tone: 'text-status-running', spins: true },
    done: { icon: CircleCheck, tone: 'text-status-idle', spins: false },
    failed: { icon: CircleX, tone: 'text-status-error', spins: false },
    cancelled: { icon: CircleSlash, tone: 'text-text-faint', spins: false }
};

export const statusLookOf = (word: StatusWord): StatusLook => LOOKS[word];

/* A task calls its running state `open`, which is the daemon's word for it and not a person's. */
export const taskStatusWord = (status: 'open' | StatusWord): StatusWord => (status === 'open' ? 'running' : status);
