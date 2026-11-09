import { waitingOnLabel, waitingOnOf, type WaitingChild } from '@adecore/agents-react/chat';
import { useChats } from '@adecore/agents-react/state';
import { useNow } from '@adecore/ui';
import type { ChatInfo, Task } from '@ruimte/contracts';
import { endpointKey, useEndpointId } from '@/state/keys';
import { usePlans } from '@/state/plans';
import { useTasks, type TasksById } from '@/state/tasks';

const NO_CHILDREN: readonly Task[] = [];

/* The open tasks a chat gave, which its children work on. */
export function openChildTasks(tasks: TasksById | undefined, chatId: string): readonly Task[] {
    const open = Object.values(tasks ?? {}).filter((task) => task.parentId === chatId && task.status === 'open');

    return open.length === 0 ? NO_CHILDREN : open;
}

function needsPerson(info: Pick<ChatInfo, 'status' | 'requests'> | undefined): boolean {
    return info?.status === 'needs-you' || (info?.requests?.length ?? 0) > 0;
}

/*
 * The one line of what a chat waits on (`waitingOnOf`), from what this client already holds: its info,
 * the tasks it gave and their children's status, and its newest plan. Null for none, or for no chat.
 */
export function useWaitingOn(chatId: string | null, endpointId?: string): string | null {
    const scope = useEndpointId();
    const machine = endpointId || scope;
    const key = chatId === null ? null : endpointKey(machine, chatId);
    const background = useChats((s) => (key === null ? undefined : s.statusByKey[key]?.info.background));
    const delegating = useChats((s) => (key === null ? false : s.statusByKey[key]?.info.delegating === true));
    const tasks = useTasks((s) => s.byEndpoint[machine]);
    const children = chatId === null ? NO_CHILDREN : openChildTasks(tasks, chatId);
    // A count, so the status of a chat that is no child of this one draws nothing again.
    const needingYou = useChats((s) => children.filter((task) => needsPerson(s.statusByKey[endpointKey(machine, task.childId)]?.info)).length);
    const planStatus = usePlans((s) => (key === null ? undefined : s.byChat[key]?.[0]?.meta.status));

    // Which children need the person matters only by their number, which outranks every pause.
    const waitingChildren: WaitingChild[] = [
        ...Array.from({ length: needingYou }, () => ({ child: { status: 'needs-you' as const } })),
        ...children.flatMap((task) => (task.paused === undefined ? [] : [{ paused: task.paused }]))
    ];

    const waiting = waitingOnOf({ children: waitingChildren, background, delegating, planStatus });
    const now = useNow(1000, waiting?.kind === 'command');

    return waiting === null ? null : waitingOnLabel(waiting, now);
}
