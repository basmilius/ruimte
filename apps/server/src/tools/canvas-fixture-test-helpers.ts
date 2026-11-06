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
import { ProviderRegistry } from '../providers/registry.ts';
import type { SessionEvent } from '../wire.ts';
import { composeHost, type HostSource } from '../wiring/canvas-host.ts';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';

/* What a test turns between the fakes and the machine, fresh for every fixture. */
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

const FIXTURE_PROVIDERS = new ProviderRegistry();

export const TOKENS: Record<string, string> = { term: 'term-1', chat: 'chat-1', stray: 'nobody', later: 'later-1' };

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

/* The id the first line of an answer names, which is the node, view or line a tool made. */
export async function madeId(call: Promise<{ lines: string[] }>): Promise<string> {
    return (await call).lines[0]!.split('\t')[0]!;
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

export const CANVAS_LINES = ['canvas\tmain\tCanvas', 'canvas\tboard\tBoard'];

/*
 * The fakes behind the host of the tools: a project on disk with real stores, and a recording fake for
 * every other service. A test makes one in `beforeEach`, reads what the fakes recorded from its fields,
 * and ends it in `afterEach`. The host is composed from `PARTS`, one fake per agent feature.
 */
export class CanvasFixture {
    readonly knobs = {} as Knobs;
    readonly alerts: { nodeId: string; text: string }[] = [];
    readonly diagramEvents: SessionEvent[] = [];
    readonly drawingEvents: SessionEvent[] = [];
    readonly held: Array<{ projectId: string; nodeId: string; prompt: string; brief?: string }> = [];
    readonly started: AgentStart[] = [];
    readonly ended: string[] = [];
    readonly watching: Array<{ projectId: string; viewId: string; by: string }> = [];
    readonly notified: Array<Omit<Notice, 'createdAt'>> = [];
    readonly driven: Array<{ browserId: string; action: BrowserDriveAction }> = [];
    readonly madeWorktrees: Worktree[] = [];
    readonly removedWorktrees: string[] = [];
    /* When a person's snooze on a node ends, by node. */
    readonly snoozed: Record<string, number> = {};
    /* The nodes that stand for work on another machine. */
    readonly elsewhere = new Set<string>();
    /* What a person pointed each caller at with `#`, as the thread of its chat would hold it. */
    readonly pointed: Record<string, Reference[]> = {};
    readonly root: string;
    readonly folder: string;
    readonly outside: string;
    readonly worktree: string;
    readonly shotPath: string;
    readonly startClaims: StartClaims;
    readonly devices: DeviceDriver;
    tasks!: TaskStore;
    lineage!: AgentLineageStore;
    store!: ProjectStore;
    diagrams!: DiagramStore;
    drawings!: DrawingStore;
    databases!: AgentDatabases;
    projectId!: string;

    private constructor(root: string) {
        this.root = root;
        this.folder = join(root, 'repo');
        this.outside = join(root, 'elsewhere');
        this.worktree = join(root, 'worktree');
        this.shotPath = join(root, 'home', 'screenshots', 'page.png');
        this.startClaims = new StartClaims(join(root, 'home'));
        this.devices = new DeviceDriver({
            home: root,
            manager: new DeviceManager([new RecordingBackend()]),
            timers: new ManualTimers(),
            sleep: async () => undefined
        });
        Object.assign(this.knobs, {
            deleteAnyView: false,
            pageOpen: true,
            breakWrites: false,
            terminalPreference: undefined,
            delivery: { at: 'waiting', wake: false, detail: 'nothing runs in that node yet; it reads the message when it starts (1 waiting)' },
            onStart: null,
            branches: null,
            nodeSizes: {},
            installed: ['claude', 'codex', 'antigravity', 'copilot'],
            preferredSelections: {},
            modes: {},
            worktrees: []
        } satisfies Knobs);
    }

    static async create(): Promise<CanvasFixture> {
        const fixture = new CanvasFixture(await mkdtemp(join(tmpdir(), 'ruimte-canvas-tools-')));
        await fixture.open();

        return fixture;
    }

    private async open(): Promise<void> {
        const home = join(this.root, 'home');
        await mkdir(join(this.folder, 'src'), { recursive: true });
        await mkdir(this.outside);
        await mkdir(this.worktree);
        await writeFile(join(this.folder, 'src', 'main.ts'), 'export {};\n');
        await writeFile(join(this.outside, 'notes.md'), '# notes\n');
        this.lineage = new AgentLineageStore(home);
        this.tasks = new TaskStore(home);
        await this.lineage.load();
        this.store = new ProjectStore(home, projectLinks({ viewFiles: () => [this.diagrams, this.drawings] }), projectOverlays(home));
        this.diagrams = new DiagramStore(this.store);
        this.diagrams.subscribe('client-1', (event) => this.diagramEvents.push(event));
        this.drawings = new DrawingStore(this.store);
        this.drawings.subscribe('client-1', (event) => this.drawingEvents.push(event));
        // A client on its socket, which is what `open` asks the store to tell.
        this.store.subscribe('client-1', (event) => {
            if (event.event === 'project.showView') {
                this.watching.push(event.payload);
            }
        });
        const opened = await this.store.openProject({ folder: this.folder });
        this.projectId = opened.summary.projectId;
        await this.store.save(this.projectId, opened.document.rev, content());
        // Released, like a project the person switched away from while its agents keep working.
        this.store.release(this.projectId);
        const access = new DatabaseAccessStore(home);
        await access.load();
        // Only the connections of the project are read: a view names a table and never opens a session.
        this.databases = new AgentDatabases({
            service: { handle: () => Promise.reject(new Error('a view opens no session')), release: async () => undefined },
            connections: {
                connectionsOf: async () => [
                    { id: 'shop-1', name: 'Shop', shared: true, config: { engine: 'mysql', host: '127.0.0.1', user: 'root', database: 'shop' } },
                    { id: 'local-1', name: 'Local', shared: false, config: { engine: 'sqlite', path: join(this.folder, 'local.sqlite') } },
                    { id: 'bare-1', name: 'Bare', shared: false, config: { engine: 'mysql', host: '127.0.0.1', user: 'root' } },
                    { id: 'twin-1', name: 'Twin', shared: false, config: { engine: 'sqlite', path: join(this.folder, 'one.sqlite') } },
                    { id: 'twin-2', name: 'twin', shared: false, config: { engine: 'sqlite', path: join(this.folder, 'two.sqlite') } }
                ]
            },
            projects: { holdersOf: () => [] },
            access,
            passwords: new DatabasePasswords(),
            scratchFolder: join(home, 'scratch')
        });
    }

    async dispose(): Promise<void> {
        this.diagrams.closeAll();
        this.drawings.closeAll();
        this.store.closeAll();
        await rm(this.root, { recursive: true, force: true });
    }

    /* The host of the tools over these fakes; a new one for every call, so it reads the knobs as they stand then. */
    host(): CanvasHost {
        return composeHost(PARTS, this);
    }

    /* Points the caller at these ids as the project stands now, the way a message with `#` would. */
    async pointAt(caller: string, ids: string[]): Promise<void> {
        const views = (await this.store.read(this.projectId)).views;
        this.pointed[caller] = resolveReferences(ids, (id) => resolveReference(views, id, this.folder));
    }

    /* A design node on main that holds a later chat, `later-1`, with these lines drawn beside the ones there. */
    async withDesignNode(edges: ProjectEdge[]): Promise<void> {
        const current = await this.store.read(this.projectId);
        await this.replaceContent({
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

    /* One routine in the test's project; any other project has none. */
    async listRoutines(asking: string) {
        const routine = {
            id: 'morning-summary',
            title: 'Morning summary',
            kind: 'command' as const,
            command: 'git log --since=yesterday',
            schedule: { kind: 'weekly' as const, days: [1, 2, 3, 4, 5], time: '09:00' },
            outputKey: 'morning-summary'
        };
        const entry = { routine, projectId: this.projectId, projectName: 'repo', shared: true, local: {}, digest: 'd', approved: true, next: null, runs: [] };

        return { routines: asking === this.projectId ? [entry] : [], revs: {}, timeZone: 'UTC' };
    }

    /* One report in the Output of the test's project, with two versions; anything else answers as Output does for what it does not hold. */
    async readOutput(asking: string, query: { artifactId: string; versionId?: string }) {
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
        if (asking !== this.projectId || query.artifactId !== 'art-1' || version === undefined) {
            throw new ArtifactError('not-found', 'No such artifact in this project');
        }
        const artifact = { artifactId: 'art-1', projectId: this.projectId, projectName: 'repo', title: 'Morning summary', kind: 'report', createdAt: 0 };

        return { artifact, version, file: version.files[0]!, text: `v${version.number} ok`, truncated: false };
    }

    /* A tool the holder of `token` calls with JSON input, with the status the answer would have had over HTTP. */
    async invoke(
        tool: string,
        input: Record<string, unknown>,
        token = 'term',
        through: CanvasHost = this.host()
    ): Promise<{ status: number; lines: string[] }> {
        const caller = TOKENS[token];

        if (caller === undefined) {
            throw new Error(`${token} is no token of these tests`);
        }

        const { refused, lines } = await toolAnswer(tool, input, toolCall(caller, through));

        return { status: refused ? 422 : 200, lines };
    }

    onDisk(): Promise<ProjectDocument> {
        return documentOnDisk(this.folder);
    }

    async canvasOnDisk(id = 'main'): Promise<ProjectCanvasView> {
        return (await this.onDisk()).views.find((view) => view.id === id) as ProjectCanvasView;
    }

    async nodeOnDisk(id: string, view = 'main'): Promise<ProjectNode | undefined> {
        return (await this.canvasOnDisk(view)).nodes.find((node) => node.id === id);
    }

    async viewOnDisk(id: string): Promise<ProjectView | undefined> {
        return (await this.onDisk()).views.find((view) => view.id === id);
    }

    /* Puts the project as a whole, the way a person's save would. */
    async replaceContent(next: ProjectContent): Promise<void> {
        await this.store.mutate(this.projectId, () => ({ content: next, result: null }));
    }

    /* Nodes put on the main canvas beside the two the fixture has, for the tools that move what is there. */
    async seed(...nodes: ProjectNode[]): Promise<void> {
        const next = content();
        (next.views[0] as ProjectCanvasView).nodes.push(...nodes);
        await this.replaceContent(next);
    }

    /* What the whole call costs: the revision it starts from, and every project.changed a client holding the project hears. */
    async watchWrites(): Promise<{ rev: number; changed: number[] }> {
        const rev = (await this.onDisk()).rev;
        const changed: number[] = [];
        this.store.subscribe('client-2', (event) => {
            if (event.event === 'project.changed') {
                changed.push(event.payload.document.rev);
            }
        });
        this.store.hold('client-2', this.projectId);

        return { rev, changed };
    }

    /* The column of `view_list` at this index, per view id. */
    async viewListColumn(index: number, token = 'term'): Promise<Record<string, string>> {
        return Object.fromEntries(
            (await this.invoke('view_list', {}, token)).lines
                .filter((line) => !line.startsWith('self\t') && !line.startsWith('revision\t'))
                .map((line) => line.split('\t'))
                .map((fields) => [fields[0]!, fields[index]!])
        );
    }

    /* A view the caller made itself, which is the only kind `view_delete` takes away by default. */
    made(name: string, input: Record<string, unknown> = {}, token = 'term'): Promise<string> {
        return madeId(this.invoke('view_new', { name, ...input }, token));
    }

    /* Whether `view_delete` would remove each view for this caller. */
    deleteColumn(token = 'term'): Promise<Record<string, string>> {
        return this.viewListColumn(3, token);
    }

    /* The reason column beside it, which is what makes a yes or a no read as more than an opinion. */
    deleteWhy(token = 'term'): Promise<Record<string, string>> {
        return this.viewListColumn(4, token);
    }

    /* A fresh lineage store over the same home, the way a restarted daemon reads it. */
    async reloadLineage(): Promise<void> {
        this.lineage = new AgentLineageStore(join(this.root, 'home'));
        await this.lineage.load();
    }
}

/* One fixture, for a test to make in `beforeEach` and `dispose` in `afterEach`. */
export function canvasFixture(): Promise<CanvasFixture> {
    return CanvasFixture.create();
}

/*
 * The parts of the host, one fake per agent feature (`src/agent-features`). A new part of the host is
 * one entry here; a test that needs more than a fake of this kind overrides the field on the host it gets.
 */
const PARTS: readonly HostSource<CanvasFixture>[] = [
    {
        name: 'canvas',
        host: (fixture) => ({
            hiddenAgents: fixture.store.hiddenAgents,
            startClaims: fixture.startClaims,
            snoozes: { until: (nodeId) => fixture.snoozed[nodeId] ?? null },
            projects: {
                locate: (id) => fixture.store.locate(id),
                read: (id) => fixture.store.read(id),
                revision: (id) => fixture.store.revision(id),
                mutate: (id, apply, expectedRev) =>
                    fixture.store.mutate(
                        id,
                        async (current) => {
                            const mutation = await apply(current);
                            return fixture.knobs.breakWrites && mutation.content ? { ...mutation, content: withRepeatedId(mutation.content) } : mutation;
                        },
                        expectedRev
                    ),
                showView: (projectId, viewId, by) => fixture.store.showView(projectId, viewId, by),
                machineOfNode: (nodeId) => (fixture.elsewhere.has(nodeId) ? 'machine-b' : fixture.store.machineOfNode(nodeId))
            },
            checkouts: {
                paths: async () => fixture.knobs.worktrees,
                branches: async () => fixture.knobs.branches,
                add: async (_folder, want) => {
                    const taken = new Set([...(fixture.knobs.branches ?? []), ...fixture.madeWorktrees.map((made) => made.branch)]);
                    const branch = 'branch' in want ? want.branch : freeBranch(want.fresh, taken);
                    const made = { path: join(fixture.worktree, branch), branch };
                    fixture.madeWorktrees.push(made);
                    return { worktree: made, created: true };
                },
                remove: async (_folder, path) => {
                    fixture.removedWorktrees.push(path);
                },
                claim: async () => undefined
            },
            lineage: fixture.lineage,
            machine: { agentsDeleteAnyView: fixture.knobs.deleteAnyView, nodeSize: (kind) => nodeSizeOf(fixture.knobs.nodeSizes, kind) },
            endSession: async (kind, nodeId) => {
                fixture.ended.push(`${kind}\t${nodeId}`);
            },
            messages: {
                alert: (nodeId, text) => {
                    fixture.alerts.push({ nodeId, text });
                },
                notify: async (notice) => {
                    fixture.notified.push(notice);
                    return fixture.knobs.delivery;
                }
            }
        })
    },
    { name: 'view', host: (fixture) => ({ diagrams: fixture.diagrams, drawings: fixture.drawings }) },
    { name: 'database', host: (fixture) => ({ databases: fixture.databases }) },
    {
        name: 'agent',
        host: (fixture) => ({
            starts: {
                modeOf: (nodeId) => fixture.knobs.modes[nodeId] ?? 'full-access',
                terminalModePreference: () => fixture.knobs.terminalPreference,
                preferredSelection: (kind) => fixture.knobs.preferredSelections[kind],
                installedAgents: async () => fixture.knobs.installed,
                provider: (kind) => FIXTURE_PROVIDERS.get(kind),
                holdPrompt: async (projectId, nodeId, prompt, brief) => {
                    fixture.held.push({ projectId, nodeId, prompt, ...(brief === undefined ? {} : { brief }) });
                },
                startAgent: async (start) => {
                    fixture.started.push(start);
                    await fixture.knobs.onStart?.(start);
                },
                openedCount: (callerId) => fixture.lineage.openedCount(callerId)
            }
        })
    },
    { name: 'device', host: (fixture) => ({ devices: fixture.devices }) },
    {
        name: 'context',
        host: (fixture) => ({
            context: {
                list: () => [],
                answer: () => Promise.reject(new Error('no reads in these tests')),
                answerSource: () => Promise.reject(new Error('no reads in these tests')),
                referenced: (targetId) => fixture.pointed[targetId] ?? [],
                sourceFor: (targetId, sourceId) =>
                    (fixture.pointed[targetId] ?? [])
                        .flatMap((reference) => reference.sources)
                        .find((source) => source.id === sourceId || source.nodeId === sourceId) ?? null
            }
        })
    },
    {
        name: 'task',
        host: (fixture) => ({
            tasks: {
                open: (record) => fixture.tasks.open(record, 1),
                give: (record) => fixture.tasks.open(record, 1),
                // Every chat of these tests is one the daemon could open a turn in; the real states are in the task tests.
                chatState: async () => 'idle',
                done: async (childId, text) => {
                    const open = fixture.tasks.openFor(childId);
                    return open ? fixture.tasks.settle(open.id, 'done', { text, source: 'done', at: 2 }, 2) : null;
                },
                involving: (nodeId) => fixture.tasks.involving(nodeId)
            }
        })
    },
    { name: 'plan', host: () => ({ plans: { read: async () => [], create: unusedPlans, apply: unusedPlans, delete: unusedPlans } }) },
    {
        name: 'browser',
        host: (fixture) => ({
            browsers: {
                drive: async (browserId, action) => {
                    fixture.driven.push({ browserId, action });
                    return fixture.knobs.pageOpen ? { state: pageStand(browserId) } : null;
                },
                shot: async (browserId) => (fixture.knobs.pageOpen ? { path: fixture.shotPath, state: pageStand(browserId) } : null)
            }
        })
    },
    {
        name: 'artifact',
        host: (fixture) => ({
            artifacts: {
                read: (asking: string, query: { artifactId: string; versionId?: string }) => fixture.readOutput(asking, query)
            } as unknown as NonNullable<CanvasHost['artifacts']>
        })
    },
    {
        name: 'routine',
        host: (fixture) => ({ routines: { list: (asking: string) => fixture.listRoutines(asking) } as unknown as NonNullable<CanvasHost['routines']> })
    }
];
