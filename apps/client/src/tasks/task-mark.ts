import type { Task } from '@ruimte/contracts';
import { taskStatusWord } from '@adecore/agents-react/chat';
import type { AgentWork } from '@/state/agent-work';

/*
 * A task keeps its last state after the child moves on, so a mark beside a working agent or beside
 * the unseen check would say a done task next to a new turn, or the same check twice.
 */
export function showsTaskMark(task: Task, work: AgentWork | null | undefined, unseen: boolean): boolean {
    if (work !== null && work !== undefined) {
        return false;
    }
    return !unseen || taskStatusWord(task) !== 'done';
}
