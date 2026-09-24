import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { TaskSchema, type Task, type TaskResult } from '@ruimte/contracts';
import type { SessionSink } from '../sessions/manager.ts';
import { ClientSinks } from '../client-sinks.ts';
import { RecordDirectory } from '../record-directory.ts';

export type TaskListener = (task: Task) => void;

/*
 * What a chat asked of the nodes it opened with `--task`, one file per task under `$RUIMTE_HOME/tasks`,
 * beside the lineage and for the same reason: an agent with a shell in the project folder can rewrite
 * `project.json`, and waking the parent is a promise the daemon keeps. A settled task stays until its
 * parent leaves the project, so the parent can still list what came of it.
 */
export class TaskStore {
    readonly dir: string;
    private readonly tasks: RecordDirectory<Task>;
    private readonly listeners = new Set<TaskListener>();
    private readonly sinks = new ClientSinks();

    constructor(home: string) {
        this.dir = join(home, 'tasks');
        this.tasks = new RecordDirectory({ dir: this.dir, schema: TaskSchema, idOf: (task) => task.id });
    }

    /* Reads what an earlier run of the daemon wrote down. Call before any verb or observer can ask. */
    load(): Promise<void> {
        return this.tasks.load();
    }

    /* Told about every task that is written, after it is on disk. */
    onChange(listener: TaskListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /* Every socket hears every task: the edge and the header of a child are drawn from it. */
    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    async open(record: { projectId: string; parentId: string; childId: string; title: string; prompt: string; batchId?: string }, now: number): Promise<Task> {
        const task: Task = {
            ...record,
            id: `task-${randomBytes(6).toString('hex')}`,
            status: 'open',
            result: null,
            createdAt: now,
            settledAt: null,
            wake: 'pending'
        };
        await this.write(task);
        return task;
    }

    get(id: string): Task | undefined {
        return this.tasks.get(id);
    }

    /* The task a node is working on; a node has at most one, the one it was opened with. */
    openFor(childId: string): Task | undefined {
        return this.tasks.all().find((task) => task.childId === childId && task.status === 'open');
    }

    /* Every task this node gave or was given, oldest first. */
    involving(nodeId: string): Task[] {
        return this.sorted().filter((task) => task.parentId === nodeId || task.childId === nodeId);
    }

    ofParent(parentId: string): Task[] {
        return this.sorted().filter((task) => task.parentId === parentId);
    }

    ofProject(projectId: string): Task[] {
        return this.sorted().filter((task) => task.projectId === projectId);
    }

    /*
     * Ends an open task with its result; false when it was not open any more, which is how the first of
     * `done`, the end of a turn and an exit wins. A cancelled task wakes nobody.
     */
    async settle(id: string, status: 'done' | 'failed' | 'cancelled', result: TaskResult | null, now: number): Promise<Task | null> {
        const task = this.tasks.get(id);
        if (!task || task.status !== 'open') {
            return null;
        }
        const { paused: _paused, ...open } = task;
        const settled: Task = { ...open, status, result, settledAt: now, wake: status === 'cancelled' ? 'none' : task.wake };
        await this.write(settled);
        return settled;
    }

    /* Holds an open task while its child waits out a limit, or lets it go on with null; false when it was not open. */
    async pause(id: string, paused: NonNullable<Task['paused']> | null): Promise<boolean> {
        const task = this.tasks.get(id);
        if (!task || task.status !== 'open') {
            return false;
        }
        if (JSON.stringify(task.paused ?? null) === JSON.stringify(paused)) {
            return true;
        }
        const { paused: _was, ...rest } = task;
        await this.write(paused === null ? rest : { ...rest, paused });
        return true;
    }

    /* Cancels the open tasks of these children, with the reason as the result; a cancelled task wakes nobody. */
    async cancelOpen(childIds: ReadonlySet<string>, reason: string, now: number): Promise<Task[]> {
        const cancelled: Task[] = [];
        for (const task of this.sorted()) {
            if (task.status === 'open' && childIds.has(task.childId)) {
                const settled = await this.settle(task.id, 'cancelled', { text: reason, source: 'exit', at: now }, now);
                if (settled) {
                    cancelled.push(settled);
                }
            }
        }
        return cancelled;
    }

    async markWoken(ids: readonly string[]): Promise<void> {
        for (const id of ids) {
            const task = this.tasks.get(id);
            if (task && task.wake === 'pending') {
                await this.write({ ...task, wake: 'sent' });
            }
        }
    }

    pendingWake(parentId: string): Task[] {
        return this.ofParent(parentId).filter((task) => task.status !== 'open' && task.wake === 'pending');
    }

    /*
     * The part of `pendingWake` that may wake the parent now. A task of a `team --task` call is held back
     * until every task of that call settled, so one team is one answer however far apart its roles finish.
     */
    readyWake(parentId: string): Task[] {
        const open = new Set(this.openBatches(parentId));
        return this.pendingWake(parentId).filter((task) => task.batchId === undefined || !open.has(task.batchId));
    }

    /* The batches of this parent with a task still open, oldest first. */
    openBatches(parentId: string): string[] {
        const ids = this.ofParent(parentId).flatMap((task) => (task.status === 'open' && task.batchId !== undefined ? [task.batchId] : []));
        return [...new Set(ids)];
    }

    /* A parent nobody can wake any more: its settled tasks stop waiting for it. */
    async dropWake(parentId: string): Promise<void> {
        for (const task of this.ofParent(parentId)) {
            if (task.wake === 'pending') {
                await this.write({ ...task, wake: 'none' });
            }
        }
    }

    /*
     * What this project wrote down for ids it no longer has. A task whose parent is gone has nobody to
     * report to and goes; an open task whose child is gone is cancelled and stays, so its parent sees why.
     */
    async prune(projectId: string, ids: ReadonlySet<string>, now: number): Promise<Task[]> {
        const cancelled: Task[] = [];
        for (const task of this.sorted()) {
            if (task.projectId !== projectId) {
                continue;
            }
            if (!ids.has(task.parentId)) {
                await this.tasks.remove(task.id);
                continue;
            }
            if (!ids.has(task.childId) && task.status === 'open') {
                const settled = await this.settle(task.id, 'cancelled', null, now);
                if (settled) {
                    cancelled.push(settled);
                }
            }
        }
        return cancelled;
    }

    private sorted(): Task[] {
        // A stable sort: tasks made in the same millisecond keep the order they were made in.
        return this.tasks.all().sort((a, b) => a.createdAt - b.createdAt);
    }

    private async write(task: Task): Promise<void> {
        // Only the write that is still the latest tells anyone: an older record never lands after it.
        if (!(await this.tasks.write(task))) {
            return;
        }
        for (const listener of this.listeners) {
            listener(task);
        }
        this.sinks.emit({ event: 'task.changed', payload: { task } });
    }
}
