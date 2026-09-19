import i18next from 'i18next';
import { create } from 'zustand';
import type { Task } from '@ruimte/contracts';
import { useEndpointId } from '@/state/keys';

type TasksById = Readonly<Record<string, Task>>;

interface TasksStore {
    /* Per machine, the tasks it told this client about, by task id. */
    byEndpoint: Readonly<Record<string, TasksById>>;
    /* What one project of a machine answered; tasks of that project it no longer lists are gone. */
    setProjectTasks(endpointId: string, projectId: string, tasks: readonly Task[]): void;
    putTask(endpointId: string, task: Task): void;
    forget(endpointId: string): void;
}

export const useTasks = create<TasksStore>((set, get) => ({
    byEndpoint: {},
    setProjectTasks(endpointId, projectId, tasks) {
        const kept = Object.values(get().byEndpoint[endpointId] ?? {}).filter((task) => task.projectId !== projectId);
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: Object.fromEntries([...kept, ...tasks].map((task) => [task.id, task])) } });
    },
    putTask(endpointId, task) {
        const current = get().byEndpoint[endpointId] ?? {};
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...current, [task.id]: task } } });
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...rest } = get().byEndpoint;
        set({ byEndpoint: rest });
    }
}));

/* The newest of the tasks that match, since a node given a task twice shows the one it works on now. */
const newest = (tasks: TasksById | undefined, matches: (task: Task) => boolean): Task | null => {
    let found: Task | null = null;
    for (const task of Object.values(tasks ?? {})) {
        if (matches(task) && (found === null || task.createdAt >= found.createdAt)) {
            found = task;
        }
    }
    return found;
};

/* The task a node was opened with, for the mark on its header and on its sidebar row. */
export const childTask = (tasks: TasksById | undefined, childId: string): Task | null => newest(tasks, (task) => task.childId === childId);

/* The task a line stands for: the one its tail gave its head. */
export const edgeTask = (tasks: TasksById | undefined, from: string, to: string): Task | null =>
    newest(tasks, (task) => task.parentId === from && task.childId === to);

export const useChildTask = (childId: string): Task | null => {
    const endpointId = useEndpointId();
    return useTasks((s) => childTask(s.byEndpoint[endpointId], childId));
};

/* The word a line carries while it stands for a task: "task" while it is open, and how it ended after. */
export const taskEdgeLabel = (status: Task['status']): string => i18next.t(`state:taskEdge.${status}`);
