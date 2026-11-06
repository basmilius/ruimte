import { afterEach, beforeEach } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLineageStore, TaskStore, type Notice } from '@adecore/agents/coordination';
import {
    nodeSizeOf,
    type AgentKind,
    type BrowserDriveAction,
    type BrowserPageState,
    type ModelSelection,
    type NodeSizes,
    type ProjectCanvasView,
    type ProjectContent,
    type ProjectDocument,
    type ProjectEdge,
    type ProjectNode,
    type ProjectView,
    type RuntimeMode,
    type Worktree
} from '@ruimte/contracts';
import { ArtifactError } from '../artifacts/artifact-names.ts';
import type { AgentStart, CanvasHost, NoticeDelivery } from '../canvas/host.ts';
import { StartClaims } from '../canvas/start-claims.ts';
import { ManualTimers } from '../computer/computer-test-helpers.ts';
import { DatabaseAccessStore } from '../database/agent-access.ts';
import { AgentDatabases } from '../database/agent-databases.ts';
import { DatabasePasswords } from '../database/agent-passwords.ts';
import { DeviceDriver } from '../devices/agent-driver.ts';
import { RecordingBackend } from '../devices/device-test-helpers.ts';
import { DeviceManager } from '../devices/manager.ts';
import { freeBranch } from '../git/worktrees.ts';
import { DiagramStore } from '../projects/diagram-store.ts';
import { DrawingStore } from '../projects/drawing-store.ts';
import { projectOverlays } from '../projects/overlays.ts';
import { documentOnDisk, projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { resolveReference, resolveReferences, type Reference } from '../projects/references.ts';
import type { SessionEvent } from '../wire.ts';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';

/* What a test turns between the fakes and the machine, reset before every test. */
export interface Knobs {
    deleteAnyView: boolean;
    /* Whether any client on this machine has the page open, which is what a driver answers null without. */
    pageOpen: boolean;
    breakWrites: boolean;
    terminalPreference: RuntimeMode | undefined;
    delivery: NoticeDelivery;
    /* Hooked by a test that has to look at the project at the moment an agent is started, and not after. */
    onStart: ((start: AgentStart) => Promise<void>) | null;
    branches: string[] | null;
    nodeSizes: NodeSizes;
    installed: AgentKind[];
    preferredSelections: Partial<Record<AgentKind, ModelSelection>>;
    modes: Record<string, RuntimeMode>;
    worktrees: string[];
}

export const knobs = {} as Knobs;

export let alerts: { nodeId: string; text: string }[];
export let root: string;
export let folder: string;
export let outside: string;
export let worktree: string;
export let store: ProjectStore;
export let diagrams: DiagramStore;
export let diagramEvents: SessionEvent[];
export let drawings: DrawingStore;
export let drawingEvents: SessionEvent[];
export let projectId: string;
export let startClaims: StartClaims;
export let held: Array<{ projectId: string; nodeId: string; prompt: string; brief?: string }>;
export let started: AgentStart[];
export let lineage: AgentLineageStore;
export let ended: string[];
export let watching: Array<{ projectId: string; viewId: string; by: string }>;
export let notified: Array<Omit<Notice, 'createdAt'>>;
export let tasks: TaskStore;
export let driven: Array<{ browserId: string; action: BrowserDriveAction }>;
export let shotPath: string;
export let madeWorktrees: Worktree[];
export let removedWorktrees: string[];
export let databases: AgentDatabases;
export let snoozed: Record<string, number>;
export let elsewhere: Set<string>;
export let devices: DeviceDriver;
/* What a person pointed each caller at with `#`, as the thread of its chat would hold it. */
export let pointed: Record<string, Reference[]>;

/* Points the caller at these ids as the project stands now, the way a message with `#` would. */
export async function pointAt(caller: string, ids: string[]): Promise<void> {
    const views = (await store.read(projectId)).views;
    pointed[caller] = resolveReferences(ids, (id) => resolveReference(views, id, folder));
}

/* A change the store's own check refuses after the tool had its say: `note-1` a second time, on the board. */
export function withRepeatedId(current: ProjectContent): ProjectContent {
    return {
        ...current,
        views: current.views.map((view) =>
            view.id === 'board' && view.kind === 'canvas'
                ? { ...view, nodes: [...view.nodes, { id: 'note-1', kind: 'note', title: 'Twin', x: 0, y: 0, w: 320, h: 240 }] }
                : view
        )
    };
}

export const TOKENS: Record<string, string> = { term: 'term-1', chat: 'chat-1', stray: 'nobody', later: 'later-1' };

/* A design node on main that holds a later chat, `later-1`, with these lines drawn beside the ones there. */
export async function withDesignNode(edges: ProjectEdge[]): Promise<void> {
    const current = await store.read(projectId);
    await replaceContent({
        ...current,
        views: current.views.map((view) =>
            view.id === 'main' && view.kind === 'canvas'
                ? {
                      ...view,
                      nodes: [
                          ...view.nodes,
                          {
                              id: 'design-1',
                              kind: 'design',
                              title: 'Site',
                              path: 'site',
                              x: 0,
                              y: 900,
                              w: 480,
                              h: 640,
                              chats: [{ id: 'later-1', name: 'Header', node: {} }]
                          }
                      ],
                      edges: [...view.edges, ...edges]
                  }
                : view
        )
    });
}

export function content(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [
                    { id: 'term-1', kind: 'terminal', title: 'shell', x: 0, y: 0, w: 560, h: 360 },
                    { id: 'note-1', kind: 'note', title: 'Plan\twith a tab', x: 0.4, y: 600.6, w: 320, h: 240, body: 'x' }
                ],
                texts: [{ id: 'text-1', x: 0, y: 0, text: 'hi', size: 16 }],
                edges: [],
                layouts: []
            },
            { kind: 'separator', id: 'sep-1' },
            { kind: 'canvas', id: 'board', name: 'Board', nodes: [], texts: [], edges: [], layouts: [] },
            { kind: 'chat', id: 'chat-1', name: 'Planner', node: {} },
            { kind: 'drawing', id: 'sketch-1', name: 'Sketch' }
        ]
    };
}

/* Registers the hooks that give every test of the calling file a fresh project, stores and fakes. */
export function canvasFixture(): void {
    beforeEach(async () => {
        alerts = [];
        snoozed = {};
        elsewhere = new Set();
        pointed = {};
        root = await mkdtemp(join(tmpdir(), 'ruimte-canvas-tools-'));
        devices = new DeviceDriver({
            home: root,
            manager: new DeviceManager([new RecordingBackend()]),
            timers: new ManualTimers(),
            sleep: async () => undefined
        });
        folder = join(root, 'repo');
        outside = join(root, 'elsewhere');
        worktree = join(root, 'worktree');
        await mkdir(join(folder, 'src'), { recursive: true });
        await mkdir(outside);
        await mkdir(worktree);
        await writeFile(join(folder, 'src', 'main.ts'), 'export {};\n');
        await writeFile(join(outside, 'notes.md'), '# notes\n');
        knobs.worktrees = [];
        startClaims = new StartClaims(join(root, 'home'));
        knobs.modes = {};
        knobs.terminalPreference = undefined;
        knobs.preferredSelections = {};
        knobs.branches = null;
        driven = [];
        knobs.pageOpen = true;
        shotPath = join(root, 'home', 'screenshots', 'page.png');
        madeWorktrees = [];
        removedWorktrees = [];
        knobs.breakWrites = false;
        knobs.installed = ['claude', 'codex', 'antigravity', 'copilot'];
        held = [];
        started = [];
        knobs.onStart = null;
        knobs.deleteAnyView = false;
        knobs.nodeSizes = {};
        ended = [];
        watching = [];
        notified = [];
        knobs.delivery = { at: 'waiting', wake: false, detail: 'nothing runs in that node yet; it reads the message when it starts (1 waiting)' };
        lineage = new AgentLineageStore(join(root, 'home'));
        tasks = new TaskStore(join(root, 'home'));
        await lineage.load();
        store = new ProjectStore(join(root, 'home'), projectLinks({ viewFiles: () => [diagrams, drawings] }), projectOverlays(join(root, 'home')));
        diagrams = new DiagramStore(store);
        diagramEvents = [];
        diagrams.subscribe('client-1', (event) => diagramEvents.push(event));
        drawings = new DrawingStore(store);
        drawingEvents = [];
        drawings.subscribe('client-1', (event) => drawingEvents.push(event));
        // A client on its socket, which is what `open` asks the store to tell.
        store.subscribe('client-1', (event) => {
            if (event.event === 'project.showView') {
                watching.push(event.payload);
            }
        });
        const opened = await store.openProject({ folder });
        projectId = opened.summary.projectId;
        await store.save(projectId, opened.document.rev, content());
        // Released, like a project the person switched away from while its agents keep working.
        store.release(projectId);
        const access = new DatabaseAccessStore(join(root, 'home'));
        await access.load();
        // Only the connections of the project are read: a view names a table and never opens a session.
        databases = new AgentDatabases({
            service: { handle: () => Promise.reject(new Error('a view opens no session')), release: async () => undefined },
            connections: {
                connectionsOf: async () => [
                    { id: 'shop-1', name: 'Shop', shared: true, config: { engine: 'mysql', host: '127.0.0.1', user: 'root', database: 'shop' } },
                    { id: 'local-1', name: 'Local', shared: false, config: { engine: 'sqlite', path: join(folder, 'local.sqlite') } },
                    { id: 'bare-1', name: 'Bare', shared: false, config: { engine: 'mysql', host: '127.0.0.1', user: 'root' } },
                    { id: 'twin-1', name: 'Twin', shared: false, config: { engine: 'sqlite', path: join(folder, 'one.sqlite') } },
                    { id: 'twin-2', name: 'twin', shared: false, config: { engine: 'sqlite', path: join(folder, 'two.sqlite') } }
                ]
            },
            projects: { holdersOf: () => [] },
            access,
            passwords: new DatabasePasswords(),
            scratchFolder: join(root, 'home', 'scratch')
        });
    });

    afterEach(async () => {
        diagrams.closeAll();
        drawings.closeAll();
        store.closeAll();
        await rm(root, { recursive: true, force: true });
    });
}

export function host(): CanvasHost {
    return {
        hiddenAgents: store.hiddenAgents,
        startClaims,
        databases,
        snoozes: { until: (nodeId) => snoozed[nodeId] ?? null },
        projects: {
            locate: (id) => store.locate(id),
            read: (id) => store.read(id),
            revision: (id) => store.revision(id),
            mutate: (id, apply, expectedRev) =>
                store.mutate(
                    id,
                    async (current) => {
                        const mutation = await apply(current);
                        return knobs.breakWrites && mutation.content ? { ...mutation, content: withRepeatedId(mutation.content) } : mutation;
                    },
                    expectedRev
                ),
            showView: (projectId, viewId, by) => store.showView(projectId, viewId, by),
            machineOfNode: (nodeId) => (elsewhere.has(nodeId) ? 'machine-b' : store.machineOfNode(nodeId))
        },
        checkouts: {
            paths: async () => knobs.worktrees,
            branches: async () => knobs.branches,
            add: async (_folder, want) => {
                const taken = new Set([...(knobs.branches ?? []), ...madeWorktrees.map((made) => made.branch)]);
                const branch = 'branch' in want ? want.branch : freeBranch(want.fresh, taken);
                const made = { path: join(worktree, branch), branch };
                madeWorktrees.push(made);
                return { worktree: made, created: true };
            },
            remove: async (_folder, path) => {
                removedWorktrees.push(path);
            },
            claim: async () => undefined
        },
        starts: {
            modeOf: (nodeId) => knobs.modes[nodeId] ?? 'full-access',
            terminalModePreference: () => knobs.terminalPreference,
            preferredSelection: (kind) => knobs.preferredSelections[kind],
            installedAgents: async () => knobs.installed,
            holdPrompt: async (projectId, nodeId, prompt, brief) => {
                held.push({ projectId, nodeId, prompt, ...(brief === undefined ? {} : { brief }) });
            },
            startAgent: async (start) => {
                started.push(start);
                await knobs.onStart?.(start);
            },
            openedCount: (callerId) => lineage.openedCount(callerId)
        },
        lineage,
        machine: { agentsDeleteAnyView: knobs.deleteAnyView, nodeSize: (kind) => nodeSizeOf(knobs.nodeSizes, kind) },
        endSession: async (kind, nodeId) => {
            ended.push(`${kind}\t${nodeId}`);
        },
        messages: {
            alert: (nodeId, text) => {
                alerts.push({ nodeId, text });
            },
            notify: async (notice) => {
                notified.push(notice);
                return knobs.delivery;
            }
        },
        diagrams,
        drawings,
        devices,
        context: {
            list: () => [],
            answer: () => Promise.reject(new Error('no reads in these tests')),
            answerSource: () => Promise.reject(new Error('no reads in these tests')),
            referenced: (targetId) => pointed[targetId] ?? [],
            sourceFor: (targetId, sourceId) =>
                (pointed[targetId] ?? []).flatMap((reference) => reference.sources).find((source) => source.id === sourceId || source.nodeId === sourceId) ??
                null
        },
        tasks: {
            open: (record) => tasks.open(record, 1),
            give: (record) => tasks.open(record, 1),
            // Every chat of these tests is one the daemon could open a turn in; the real states are in the task tests.
            chatState: async () => 'idle',
            done: async (childId, text) => {
                const open = tasks.openFor(childId);
                return open ? tasks.settle(open.id, 'done', { text, source: 'done', at: 2 }, 2) : null;
            },
            involving: (nodeId) => tasks.involving(nodeId)
        },
        plans: { read: async () => [], create: unusedPlans, apply: unusedPlans, delete: unusedPlans },
        browsers: {
            drive: async (browserId, action) => {
                driven.push({ browserId, action });
                return knobs.pageOpen ? { state: pageStand(browserId) } : null;
            },
            shot: async (browserId) => (knobs.pageOpen ? { path: shotPath, state: pageStand(browserId) } : null)
        },
        artifacts: { read: readOutput } as unknown as NonNullable<CanvasHost['artifacts']>,
        routines: { list: listRoutines } as unknown as NonNullable<CanvasHost['routines']>
    };
}

/* One routine in the test's project; any other project has none. */
export async function listRoutines(asking: string) {
    const routine = {
        id: 'morning-summary',
        title: 'Morning summary',
        kind: 'command' as const,
        command: 'git log --since=yesterday',
        schedule: { kind: 'weekly' as const, days: [1, 2, 3, 4, 5], time: '09:00' },
        outputKey: 'morning-summary'
    };
    const entry = { routine, projectId, projectName: 'repo', shared: true, local: {}, digest: 'd', approved: true, next: null, runs: [] };
    return { routines: asking === projectId ? [entry] : [], revs: {}, timeZone: 'UTC' };
}

/* One report in the Output of the test's project, with two versions; anything else answers as Output does for what it does not hold. */
export async function readOutput(asking: string, query: { artifactId: string; versionId?: string }) {
    const versions = ['ver-2', 'ver-1'].map((versionId, index) => ({
        versionId,
        number: 2 - index,
        createdAt: 0,
        files: [{ name: 'summary.md', mime: 'text/markdown', size: 6, sha256: versionId }],
        bytes: 6,
        provenance: { maker: 'agent' as const, machineId: 'machine-1' },
        copiedTo: []
    }));
    const version = query.versionId === undefined ? versions[0] : versions.find((entry) => entry.versionId === query.versionId);
    if (asking !== projectId || query.artifactId !== 'art-1' || version === undefined) {
        throw new ArtifactError('not-found', 'No such artifact in this project');
    }
    const artifact = { artifactId: 'art-1', projectId, projectName: 'repo', title: 'Morning summary', kind: 'report', createdAt: 0 };
    return { artifact, version, file: version.files[0]!, text: `v${version.number} ok`, truncated: false };
}

/* Where the fake page stands: enough for a test to read every column the tool prints. */
export function pageStand(browserId: string): BrowserPageState {
    return {
        browserId,
        url: 'https://example.com/two',
        title: 'Two',
        loading: false,
        canGoBack: true,
        canGoForward: false,
        error: null
    };
}

export function unusedPlans(): Promise<never> {
    return Promise.reject(new Error('no plans in these tests'));
}

/* A tool the holder of `token` calls with JSON input, with the status the answer would have had over HTTP. */
export async function invoke(
    tool: string,
    input: Record<string, unknown>,
    token = 'term',
    through: CanvasHost = host()
): Promise<{ status: number; lines: string[] }> {
    const caller = TOKENS[token];

    if (caller === undefined) {
        throw new Error(`${token} is no token of these tests`);
    }

    const { refused, lines } = await toolAnswer(tool, input, toolCall(caller, through));

    return { status: refused ? 422 : 200, lines };
}

export function onDisk(): Promise<ProjectDocument> {
    return documentOnDisk(folder);
}

export async function canvasOnDisk(id = 'main'): Promise<ProjectCanvasView> {
    return (await onDisk()).views.find((view) => view.id === id) as ProjectCanvasView;
}

export async function nodeOnDisk(id: string, view = 'main'): Promise<ProjectNode | undefined> {
    return (await canvasOnDisk(view)).nodes.find((node) => node.id === id);
}

/* The id the first line of an answer names, which is the node, view or line a tool made. */
export async function madeId(call: Promise<{ lines: string[] }>): Promise<string> {
    return (await call).lines[0]!.split('\t')[0]!;
}

/* Puts the project as a whole, the way a person's save would. */
export async function replaceContent(next: ProjectContent): Promise<void> {
    await store.mutate(projectId, () => ({ content: next, result: null }));
}

/* Nodes put on the main canvas beside the two the fixture has, for the tools that move what is there. */
export async function seed(...nodes: ProjectNode[]): Promise<void> {
    const next = content();
    (next.views[0] as ProjectCanvasView).nodes.push(...nodes);
    await replaceContent(next);
}

export function box(id: string, x: number, y: number, extra: Partial<ProjectNode> = {}): ProjectNode {
    return {
        id,
        kind: 'note',
        title: id,
        x,
        y,
        w: 200,
        h: 100,
        ...extra
    };
}

/* The revision on the last line of a list. */
export function revisionOf(lines: string[]): number {
    return Number(lines.at(-1)!.split('\t')[1]);
}

/* What the whole call costs: the revision it starts from, and every project.changed a client holding the project hears. */
export async function watchWrites(): Promise<{ rev: number; changed: number[] }> {
    const rev = (await onDisk()).rev;
    const changed: number[] = [];
    store.subscribe('client-2', (event) => {
        if (event.event === 'project.changed') {
            changed.push(event.payload.document.rev);
        }
    });
    store.hold('client-2', projectId);
    return { rev, changed };
}

/* The column of `view_list` at this index, per view id. */
export async function viewListColumn(index: number, token = 'term'): Promise<Record<string, string>> {
    return Object.fromEntries(
        (await invoke('view_list', {}, token)).lines
            .filter((line) => !line.startsWith('self\t') && !line.startsWith('revision\t'))
            .map((line) => line.split('\t'))
            .map((fields) => [fields[0]!, fields[index]!])
    );
}

export const CANVAS_LINES = ['canvas\tmain\tCanvas', 'canvas\tboard\tBoard'];

/* A view the caller made itself, which is the only kind `view_delete` takes away by default. */
export function made(name: string, input: Record<string, unknown> = {}, token = 'term'): Promise<string> {
    return madeId(invoke('view_new', { name, ...input }, token));
}

/* Whether `view_delete` would remove each view for this caller. */
export function deleteColumn(token = 'term'): Promise<Record<string, string>> {
    return viewListColumn(3, token);
}

/* The reason column beside it, which is what makes a yes or a no read as more than an opinion. */
export function deleteWhy(token = 'term'): Promise<Record<string, string>> {
    return viewListColumn(4, token);
}

export async function viewOnDisk(id: string): Promise<ProjectView | undefined> {
    return (await onDisk()).views.find((view) => view.id === id);
}

/* A fresh lineage store over the same home, the way a restarted daemon reads it. */
export async function reloadLineage(): Promise<void> {
    lineage = new AgentLineageStore(join(root, 'home'));
    await lineage.load();
}
