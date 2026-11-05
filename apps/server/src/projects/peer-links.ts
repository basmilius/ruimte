import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { RecordDirectory } from '@adecore/agents';
import { RuntimeModeSchema, isCanvasView, type PeerLink, type ProjectContent, type RuntimeMode } from '@ruimte/contracts';
import { z } from 'zod';
import { ClientSinks } from '../client-sinks.ts';
import type { SessionSink } from '../wire.ts';

const LinkSchema = z.looseObject({
    projectId: z.string().min(1),
    ceiling: RuntimeModeSchema,
    createdAt: z.number().int().nonnegative(),
    lastUsedAt: z.number().int().nonnegative().optional()
});

const TaskRecordSchema = z.object({
    projectId: z.string().min(1),
    cwd: z.string().min(1),
    /* Whether this machine made the folder for the task, which a person removes and nothing else does. */
    worktree: z.boolean()
});

/* Where this machine started a task of another machine, which only this machine writes down. */
type PeerTaskRecord = z.infer<typeof TaskRecordSchema>;

const PeerFileSchema = z.looseObject({
    machineId: z.string().min(1),
    label: z.string().min(1),
    links: z.array(LinkSchema).default([]),
    // Per project, the ids of the nodes the other machine's window placed, which are the only ones its window may rewrite or remove.
    placed: z.record(z.string(), z.array(z.string())).optional(),
    // Per node, where its task runs here.
    tasks: z.record(z.string(), TaskRecordSchema).optional()
});

type PeerFile = z.infer<typeof PeerFileSchema>;

const WorktreeSchema = z.looseObject({ cwd: z.string().min(1), branch: z.string().min(1).optional() });

/* The record of a folder is keyed on a hash, since a path of any length is no file name. */
function folderKey(cwd: string): string {
    return createHash('sha256').update(cwd).digest('hex');
}

/* What a link is until a person says otherwise: an agent from the other machine asks before it acts. */
const DEFAULT_CEILING: RuntimeMode = 'supervised';

/* The canvas this machine keeps for the nodes of one other machine in a project. */
export function peerCanvasId(machineId: string): string {
    return `peer-${machineId}`;
}

/*
 * The document with exactly these canvases hidden. Hidden is not stored, as a node's machine is not:
 * it follows from a link here, so a project file never says which machines work in it.
 */
export function withHiddenCanvases<T extends ProjectContent>(content: T, hidden: ReadonlySet<string>): T {
    let changed = false;
    const views = content.views.map((view) => {
        if (!isCanvasView(view)) {
            return view;
        }
        const want = hidden.has(view.id);
        if (want ? view.hidden === true : view.hidden === undefined) {
            return view;
        }
        changed = true;
        const { hidden: _hidden, ...rest } = view;
        return want ? { ...rest, hidden: true as const } : rest;
    });
    return changed ? { ...content, views } : content;
}

/*
 * Which project here each other machine may work in, under `$RUIMTE_HOME/peers`. Only a person on a
 * client of this machine changes it, and an agent has no socket to do so. Nothing a machine asks for
 * is granted without a link in this store.
 */
export class PeerLinks {
    private readonly files: RecordDirectory<PeerFile>;
    // Every folder this machine made from work another machine sent. A link can go, the folder and what it holds stay.
    private readonly worktrees: RecordDirectory<z.infer<typeof WorktreeSchema>>;
    private readonly sinks = new ClientSinks();
    private readonly clock: () => number;

    constructor(home: string, clock: () => number = Date.now) {
        this.files = new RecordDirectory({ dir: join(home, 'peers'), schema: PeerFileSchema, idOf: (file) => file.machineId });
        this.worktrees = new RecordDirectory({ dir: join(home, 'peer-worktrees'), schema: WorktreeSchema, idOf: (record) => folderKey(record.cwd) });
        this.clock = clock;
    }

    /* Reads what an earlier run of the daemon wrote down. Call before any request is answered. */
    async load(): Promise<void> {
        await Promise.all([this.files.load(), this.worktrees.load()]);
    }

    /* The folders made from another machine's work, whose contents that machine wrote and this one never vouched for. */
    worktreeFolders(): string[] {
        const recorded = this.files.all().flatMap((file) =>
            Object.values(file.tasks ?? {})
                .filter((record) => record.worktree)
                .map((record) => record.cwd)
        );
        return [...new Set([...recorded, ...this.worktrees.all().map((record) => record.cwd)])];
    }

    /* Every client hears when a link is made, changed or removed. */
    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* Every link, without the project name, which only the project registry knows. */
    list(): Array<Omit<PeerLink, 'projectName'>> {
        return this.files.all().flatMap((file) => file.links.map((link) => ({ ...link, machineId: file.machineId, label: file.label })));
    }

    linkOf(machineId: string, projectId: string): Omit<PeerLink, 'projectName'> | null {
        return this.list().find((link) => link.machineId === machineId && link.projectId === projectId) ?? null;
    }

    /* The canvases of this project that other machines' nodes live on. */
    canvasIdsOf(projectId: string): Set<string> {
        return new Set(
            this.files
                .all()
                .filter((file) => file.links.some((link) => link.projectId === projectId))
                .map((file) => peerCanvasId(file.machineId))
        );
    }

    /* The ids of the nodes that machine's window placed in a project. */
    placedOf(machineId: string, projectId: string): ReadonlySet<string> {
        return new Set(this.files.get(machineId)?.placed?.[projectId] ?? []);
    }

    /* Written down at once in memory, so the next question already sees it; a machine without a link has nothing to place. */
    setPlaced(machineId: string, projectId: string, ids: Iterable<string>): Promise<boolean> {
        const file = this.files.get(machineId);
        if (file === undefined) {
            return Promise.resolve(false);
        }
        return this.files.write({ ...file, placed: { ...file.placed, [projectId]: [...ids] } });
    }

    taskRecord(machineId: string, nodeId: string): PeerTaskRecord | null {
        return this.files.get(machineId)?.tasks?.[nodeId] ?? null;
    }

    /* Every task of that machine that has a record, by node. */
    taskRecordsOf(machineId: string): Array<[string, PeerTaskRecord]> {
        return Object.entries(this.files.get(machineId)?.tasks ?? {});
    }

    /* The local branches whose work came from another machine, so a branch cut from one is untrusted too. */
    peerBranches(): string[] {
        return this.worktrees.all().flatMap((record) => (record.branch === undefined ? [] : [record.branch]));
    }

    /*
     * Makes a folder one this machine never vouched for, whoever asked for it and whether or not a link is left.
     * A branch written down once stays when the folder is written again without one.
     */
    async untrustFolder(cwd: string, branch?: string): Promise<void> {
        const kept = branch ?? this.worktrees.get(folderKey(cwd))?.branch;
        await this.worktrees.write({ cwd, ...(kept === undefined ? {} : { branch: kept }) });
    }

    async recordTask(machineId: string, nodeId: string, record: PeerTaskRecord): Promise<void> {
        // Whether or not the link is still there: the folder exists and holds that machine's files either way.
        if (record.worktree) {
            await this.untrustFolder(record.cwd);
        }
        const file = this.files.get(machineId);
        if (file !== undefined) {
            await this.files.write({ ...file, tasks: { ...file.tasks, [nodeId]: record } });
        }
    }

    async forgetTask(machineId: string, nodeId: string): Promise<void> {
        const file = this.files.get(machineId);
        if (file?.tasks?.[nodeId] !== undefined) {
            const { [nodeId]: _gone, ...tasks } = file.tasks;
            await this.files.write({ ...file, tasks });
        }
    }

    /* Making a link that exists changes its label and, when one is given, its ceiling. */
    async bind(machineId: string, label: string, projectId: string, ceiling?: RuntimeMode): Promise<Omit<PeerLink, 'projectName'>> {
        const file = this.files.get(machineId);
        const held = file?.links.find((link) => link.projectId === projectId);
        const link = { ...held, projectId, ceiling: ceiling ?? held?.ceiling ?? DEFAULT_CEILING, createdAt: held?.createdAt ?? this.clock() };
        await this.write({ ...file, machineId, label, links: [...(file?.links.filter((other) => other.projectId !== projectId) ?? []), link] });
        return { ...link, machineId, label };
    }

    /* False when there is no such link. */
    async setCeiling(machineId: string, projectId: string, ceiling: RuntimeMode): Promise<boolean> {
        const file = this.files.get(machineId);
        if (!file?.links.some((link) => link.projectId === projectId)) {
            return false;
        }
        await this.write({ ...file, links: file.links.map((link) => (link.projectId === projectId ? { ...link, ceiling } : link)) });
        return true;
    }

    /* Notes that the other machine did something here; nobody hears of it, since a list that reloads on every request is no list. */
    async touch(machineId: string, projectId: string): Promise<void> {
        const file = this.files.get(machineId);
        if (!file?.links.some((link) => link.projectId === projectId)) {
            return;
        }
        await this.files.write({ ...file, links: file.links.map((link) => (link.projectId === projectId ? { ...link, lastUsedAt: this.clock() } : link)) });
    }

    /* False when there is no such link. A machine with no link left has no file. */
    async unbind(machineId: string, projectId: string): Promise<boolean> {
        const file = this.files.get(machineId);
        if (!file?.links.some((link) => link.projectId === projectId)) {
            return false;
        }
        const links = file.links.filter((link) => link.projectId !== projectId);
        const { [projectId]: _placed, ...placed } = file.placed ?? {};
        const tasks = Object.fromEntries(Object.entries(file.tasks ?? {}).filter(([, record]) => record.projectId !== projectId));
        if (links.length === 0) {
            await this.files.remove(machineId);
            this.sinks.emit({ event: 'peer.changed', payload: {} });
            return true;
        }
        await this.write({ ...file, links, placed, tasks });
        return true;
    }

    /* Every link of a project that is gone goes with it. */
    async forgetProject(projectId: string): Promise<void> {
        for (const file of this.files.all().filter((candidate) => candidate.links.some((link) => link.projectId === projectId))) {
            await this.unbind(file.machineId, projectId);
        }
    }

    private async write(file: PeerFile): Promise<void> {
        await this.files.write(file);
        this.sinks.emit({ event: 'peer.changed', payload: {} });
    }
}
