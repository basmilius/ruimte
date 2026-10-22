import type { RemoteStatusEvent, Task } from '@ruimte/contracts';
import { useCanvas } from '@/state/canvas';
import { isUnstarted, isUntaken, useRemoteStatus } from '@/state/remote-status';
import { useTasks } from '@/state/tasks';
import { useWorkspace } from '@/transport/connections';

type TasksById = Readonly<Record<string, Task>>;
type StatusByMachine = Readonly<Record<string, RemoteStatusEvent>> | undefined;

/* The open task of a node that works on another machine, which is the task that waits when that machine does not answer. */
export function openTaskOf(tasks: TasksById | undefined, childId: string): Task | null {
    let found: Task | null = null;
    for (const task of Object.values(tasks ?? {})) {
        if (task.childId === childId && task.status === 'open' && (found === null || task.createdAt >= found.createdAt)) {
            found = task;
        }
    }
    return found;
}

/* A machine a node waits for, and how many of its tasks wait on it. */
export interface WaitedFor {
    machine: string;
    count: number;
}

/* The machines a node waits for: those its open tasks were given to and that have not taken them yet. */
export function waitingMachinesOf(
    tasks: TasksById | undefined,
    parentId: string,
    machineOf: (childId: string) => string | undefined,
    status: StatusByMachine
): WaitedFor[] {
    const counts = new Map<string, number>();
    for (const task of Object.values(tasks ?? {})) {
        const machine = task.parentId === parentId && task.status === 'open' ? machineOf(task.childId) : undefined;
        if (machine !== undefined && isUnstarted(status?.[machine], task.childId)) {
            counts.set(machine, (counts.get(machine) ?? 0) + 1);
        }
    }
    return [...counts].map(([machine, count]) => ({ machine, count }));
}

/* The machines a node waits for. */
export function useWaitingMachines(parentId: string): WaitedFor[] {
    const workspaceId = useWorkspace()?.connection.endpointId ?? '';
    const tasks = useTasks((state) => state.byEndpoint[workspaceId]);
    const status = useRemoteStatus((state) => state.byEndpoint[workspaceId]);
    const childIds = Object.values(tasks ?? {})
        .filter((task) => task.parentId === parentId && task.status === 'open')
        .map((task) => task.childId);
    // One string, so a node moving on the canvas does not redraw every parent.
    const machines = useCanvas((state) => childIds.map((childId) => state.nodes[childId]?.machine ?? '').join('\n'));
    const byChild = new Map(childIds.map((childId, i) => [childId, machines.split('\n')[i] || undefined]));
    return waitingMachinesOf(tasks, parentId, (childId) => byChild.get(childId), status);
}

/* The task of a node that its machine has not taken yet, or null once it did or when nothing was given to it. */
export function useUnstartedTask(childId: string, machine: string | undefined): Task | null {
    const workspaceId = useWorkspace()?.connection.endpointId ?? '';
    const tasks = useTasks((state) => state.byEndpoint[workspaceId]);
    const unstarted = useRemoteStatus((state) => machine !== undefined && isUnstarted(state.byEndpoint[workspaceId]?.[machine], childId));
    return unstarted ? openTaskOf(tasks, childId) : null;
}

/* The task of a node that its machine has not taken yet, with the link open or not: the node is not shown before the task is there. */
export function useUntakenTask(childId: string, machine: string | undefined): Task | null {
    const workspaceId = useWorkspace()?.connection.endpointId ?? '';
    const tasks = useTasks((state) => state.byEndpoint[workspaceId]);
    const open = openTaskOf(tasks, childId);
    const untaken = useRemoteStatus((state) => machine !== undefined && isUntaken(state.byEndpoint[workspaceId]?.[machine], childId, open !== null));
    return untaken ? open : null;
}
