import type { ChatStatuses } from '@adecore/agents-react/state';
import { sessionStatus, type Task } from '@ruimte/contracts';
import { endpointKey, endpointOfNode } from '@/state/keys';
import type { SessionsByKey } from '@/state/sessions';
import type { TasksById } from '@/state/tasks';
import { waitDate } from '@/state/waiting-date';

/* Why a child an agent delegated to holds still: it waits on a person, or its last turn stopped on a limit. */
export type ChildWait = { kind: 'needs-you'; task: Task; since: number } | { kind: 'paused'; task: Task; limit: 'usage' | 'overload'; until: number | null };

/* The tasks this node gave that are still open, oldest first. */
export function openChildTasks(tasks: TasksById | undefined, parentId: string): Task[] {
    return Object.values(tasks ?? {})
        .filter((task) => task.parentId === parentId && task.status === 'open')
        .sort((before, next) => before.createdAt - next.createdAt);
}

/*
 * The child of this node a person should look at, read from the child's own status and never written to
 * the parent's. A child that waits on a person comes before one paused on a limit, the longest wait first.
 * `endpointId` is the parent's machine, which keeps its tasks; a child elsewhere names its own.
 */
export function childWaitOf(
    parentId: string,
    tasks: TasksById | undefined,
    sessions: SessionsByKey,
    chats: ChatStatuses,
    endpointId: string
): ChildWait | null {
    let waiting: ChildWait | null = null;
    let paused: ChildWait | null = null;

    for (const task of openChildTasks(tasks, parentId)) {
        const key = endpointKey(endpointOfNode(task, endpointId), task.childId);

        if (childNeedsYou(key, sessions, chats)) {
            const since = waitDate(chats[key]?.info.requests ?? [], undefined, sessions[key]?.agent?.updatedAt);

            if (waiting === null || since < waiting.since) {
                waiting = { kind: 'needs-you', task, since };
            }

            continue;
        }

        if (task.paused !== undefined && paused === null) {
            paused = { kind: 'paused', task, limit: task.paused.kind, until: task.paused.until ?? null };
        }
    }

    return waiting ?? paused;
}

/*
 * Whether this node waits on a person through a child agent that no count holds of its own, such as a
 * hidden agent, which stands in no view. A child among `counted` already counts where it stands.
 */
export function waitsThroughChild(
    parentId: string,
    tasks: TasksById | undefined,
    sessions: SessionsByKey,
    chats: ChatStatuses,
    endpointId: string,
    counted: ReadonlySet<string>
): boolean {
    return openChildTasks(tasks, parentId).some(
        (task) => !counted.has(task.childId) && childNeedsYou(endpointKey(endpointOfNode(task, endpointId), task.childId), sessions, chats)
    );
}

function childNeedsYou(key: string, sessions: SessionsByKey, chats: ChatStatuses): boolean {
    const chat = chats[key]?.info;

    return chat === undefined ? sessionStatus(sessions[key]) === 'needs-you' : chat.status === 'needs-you' || (chat.requests ?? []).length > 0;
}
