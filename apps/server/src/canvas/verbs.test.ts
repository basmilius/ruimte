import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    CANVAS_GRID,
    ContextSourceSchema,
    DIAGRAM_SHAPES,
    DiagramDirectionSchema,
    DiagramEdgeSchema,
    DiagramEdgeStyleSchema,
    DiagramGroupSchema,
    DiagramMetaSchema,
    DiagramNodeSchema,
    DrawingColorSchema,
    EDGE_ROLES,
    type BrowserDriveAction,
    type BrowserPageState,
    GROUP_HEADER,
    GROUP_PADDING,
    NODE_ACCENT_NAMES,
    NODE_SIZE,
    PROJECT_ICON_NAMES,
    type AgentKind,
    type ProjectCanvasView,
    type ProjectContent,
    type ProjectDocument,
    type ProjectEdge,
    type ProjectNode,
    type ProjectView,
    type RuntimeMode,
    type Worktree
} from '@ruimte/contracts';
import { SESSION_VARIABLES } from '../config.ts';
import { MAX_SCREEN_LINES } from '../context/context-store.ts';
import { documentOnDisk, rawPrivateViews, setPrivateViews } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { DiagramStore } from '../projects/diagram-store.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { AgentLineageStore } from '../agents/lineage.ts';
import { DIAGRAM_EXAMPLE } from './diagram-verb.ts';
import { MAX_PROMPT_LENGTH } from '../agents/pending-prompts.ts';
import { CANVAS_PATH, handleCanvasRequest } from './canvas-route.ts';
import { MAX_AGENT_DEPTH, MAX_OPENED_PER_CALLER, MAX_TEAM_DEPTH } from './depth.ts';
import { AGENT_KINDS } from './agent-verb.ts';
import { MAX_LINKS } from './link-verb.ts';
import { MAX_CANVAS_NODES } from './node-verb.ts';
import { PLACEMENT_GAP, TEAM_COLUMNS } from './placement.ts';
import { MAX_ROLES, ROLES_SHAPE } from './team-verb.ts';
import { MAX_PROJECT_VIEWS, VIEW_KINDS } from './view-verb.ts';
import { MAX_NOTICE_LENGTH } from '../context/notices.ts';
import type { Notice, NoticeDelivery } from '../context/notices.ts';
import { MAX_TITLE_LENGTH, NEW_NODE, OPENING_OFF_CANVAS, type AgentStart, type CanvasHost, type Noun } from './verb.ts';
import { VERBS } from './verbs.ts';
import { TaskStore } from '../tasks/task-store.ts';
import { MAX_TASK_PROMPT_LENGTH, nextLine, taskBrief } from './task-verbs.ts';

const nounNamed = (name: string): Noun => VERBS.find((entry): entry is Noun => entry.served === 'noun' && entry.name === name)!;

const VIEW_SUBS = nounNamed('view').actions;

let root: string;
let folder: string;
let outside: string;
let worktree: string;
let store: ProjectStore;
let diagrams: DiagramStore;
let diagramEvents: SessionEvent[];
let projectId: string;
let worktrees: string[];
let installed: AgentKind[];
let held: Array<{ projectId: string; nodeId: string; prompt: string }>;
let started: AgentStart[];
/* Hooked by a test that has to look at the project at the moment an agent is started, and not after. */
let onStart: ((start: AgentStart) => Promise<void>) | null;
let lineage: AgentLineageStore;
let deleteAnyView: boolean;
let ended: string[];
let watching: Array<{ projectId: string; viewId: string; by: string }>;
let notified: Array<Omit<Notice, 'createdAt'>>;
let delivery: NoticeDelivery;
let breakWrites: boolean;
let tasks: TaskStore;
let modes: Record<string, RuntimeMode>;
let terminalPreference: RuntimeMode | undefined;
let branches: string[] | null;
let driven: Array<{ browserId: string; action: BrowserDriveAction }>;
/* Whether any client on this machine has the page open, which is what a driver answers null without. */
let pageOpen: boolean;
let shotPath: string;
let madeWorktrees: Worktree[];
let removedWorktrees: string[];

/* A change the store's own check refuses after the verb had its say: `note-1` a second time, on the board. */
const withRepeatedId = (current: ProjectContent): ProjectContent => ({
    ...current,
    views: current.views.map((view) =>
        view.id === 'board' && view.kind === 'canvas'
            ? { ...view, nodes: [...view.nodes, { id: 'note-1', kind: 'note', title: 'Twin', x: 0, y: 0, w: 320, h: 240 }] }
            : view
    )
});

const TOKENS: Record<string, string> = { term: 'term-1', chat: 'chat-1', stray: 'nobody' };

const content = (): ProjectContent => ({
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
});

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-verbs-'));
    folder = join(root, 'repo');
    outside = join(root, 'elsewhere');
    worktree = join(root, 'worktree');
    await mkdir(join(folder, 'src'), { recursive: true });
    await mkdir(outside);
    await mkdir(worktree);
    await writeFile(join(folder, 'src', 'main.ts'), 'export {};\n');
    await writeFile(join(outside, 'notes.md'), '# notes\n');
    worktrees = [];
    modes = {};
    terminalPreference = undefined;
    branches = null;
    driven = [];
    pageOpen = true;
    shotPath = join(root, 'home', 'screenshots', 'page.png');
    madeWorktrees = [];
    removedWorktrees = [];
    breakWrites = false;
    installed = ['claude', 'codex', 'gemini', 'copilot'];
    held = [];
    started = [];
    onStart = null;
    deleteAnyView = false;
    ended = [];
    watching = [];
    notified = [];
    delivery = { at: 'waiting', wake: false, detail: 'nothing runs in that node yet; it reads the message when it starts (1 waiting)' };
    lineage = new AgentLineageStore(join(root, 'home'));
    tasks = new TaskStore(join(root, 'home'));
    await lineage.load();
    store = new ProjectStore(join(root, 'home'));
    diagrams = new DiagramStore(store);
    store.attachDiagrams(diagrams);
    diagramEvents = [];
    diagrams.subscribe('client-1', (event) => diagramEvents.push(event));
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
});

afterEach(async () => {
    diagrams.closeAll();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

const host = (): CanvasHost => ({
    locate: (id) => store.index.locate(id),
    read: (id) => store.read(id),
    revision: (id) => store.revision(id),
    mutate: (id, apply, expectedRev) =>
        store.mutate(
            id,
            async (current) => {
                const mutation = await apply(current);
                return breakWrites && mutation.content ? { ...mutation, content: withRepeatedId(mutation.content) } : mutation;
            },
            expectedRev
        ),
    worktreePaths: async () => worktrees,
    branchesOf: async () => branches,
    addWorktree: async (_folder, branch) => {
        const made = { path: join(worktree, branch), branch };
        madeWorktrees.push(made);
        return { worktree: made, created: true };
    },
    removeWorktree: async (_folder, path) => {
        removedWorktrees.push(path);
    },
    claimWorktree: async () => undefined,
    modeOf: (nodeId) => modes[nodeId] ?? 'full-access',
    terminalModePreference: () => terminalPreference,
    installedAgents: async () => installed,
    holdPrompt: async (projectId, nodeId, prompt) => {
        held.push({ projectId, nodeId, prompt });
    },
    startAgent: async (start) => {
        started.push(start);
        await onStart?.(start);
    },
    depthOf: (nodeId) => lineage.depthOf(nodeId),
    openedCount: (callerId) => lineage.openedCount(callerId),
    recordMade: (record) => lineage.put(record),
    madeBy: (nodeId) => lineage.madeBy(nodeId),
    agentsDeleteAnyView: () => deleteAnyView,
    showView: (projectId, viewId, by) => store.showView(projectId, viewId, by),
    endSession: async (kind, nodeId) => {
        ended.push(`${kind}\t${nodeId}`);
    },
    notify: async (notice) => {
        notified.push(notice);
        return delivery;
    },
    writeDiagram: (projectId, viewId, content) => diagrams.write(projectId, viewId, content),
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
            return pageOpen ? { state: pageStand(browserId) } : null;
        },
        shot: async (browserId) => (pageOpen ? { path: shotPath, state: pageStand(browserId) } : null)
    }
});

/* Where the fake page stands: enough for a test to read every column the verb prints. */
const pageStand = (browserId: string): BrowserPageState => ({
    browserId,
    url: 'https://example.com/two',
    title: 'Two',
    loading: false,
    canGoBack: true,
    canGoForward: false,
    error: null
});

const unusedPlans = (): Promise<never> => Promise.reject(new Error('no plans in these tests'));

const post = async (verb: string, argv: string[], token = 'term'): Promise<{ status: number; lines: string[] }> => {
    const path = `${CANVAS_PATH}/${verb}`;
    const response = await handleCanvasRequest(
        new Request(`http://127.0.0.1${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ argv }) }),
        path,
        { targetForToken: (value) => TOKENS[value] ?? null, host: host() }
    );
    const body = await response.text();
    return { status: response.status, lines: body === '' ? [] : body.replace(/\n$/, '').split('\n') };
};

const onDisk = (): Promise<ProjectDocument> => documentOnDisk(folder);

const canvasOnDisk = async (id = 'main'): Promise<ProjectCanvasView> => (await onDisk()).views.find((view) => view.id === id) as ProjectCanvasView;

const CANVAS_LINES = ['canvas\tmain\tCanvas', 'canvas\tboard\tBoard'];

/* A view the caller made itself, which is the only kind `view delete` takes away by default. */
const made = async (name: string, argv: string[] = [], token = 'term'): Promise<string> =>
    (await post('view', ['new', name, ...argv], token)).lines[0]!.split('\t')[0]!;

/* The last column of `views`, per view id: whether `view delete` would remove it for this caller. */
const deleteColumn = async (token = 'term'): Promise<Record<string, string>> =>
    Object.fromEntries(
        (await post('view', ['list'], token)).lines
            .filter((line) => !line.startsWith('self\t') && !line.startsWith('revision\t'))
            .map((line) => line.split('\t'))
            .map(([id, , , may]) => [id!, may!])
    );

/* The reason column beside it, which is what makes a yes or a no read as more than an opinion. */
const deleteWhy = async (token = 'term'): Promise<Record<string, string>> =>
    Object.fromEntries(
        (await post('view', ['list'], token)).lines
            .filter((line) => !line.startsWith('self\t') && !line.startsWith('revision\t'))
            .map((line) => line.split('\t'))
            .map(([id, , , , why]) => [id!, why!])
    );

const viewOnDisk = async (id: string): Promise<ProjectView | undefined> => (await onDisk()).views.find((view) => view.id === id);

/* What the root of `help` and an unknown verb print, one row per entry of the registry. */
const rootRows = (): string[] =>
    VERBS.map((entry) =>
        entry.served === 'noun'
            ? `noun\t${entry.name}\t${entry.actions.map((action) => action.word).join('|')}\t${entry.summary}`
            : `verb\t${entry.name}\t${entry.usage}\t${entry.summary}`
    );

const HELP_LINE = 'detail\truimte-context help\tevery verb and noun, with what each takes';

/* Every action of every noun with its noun, so a test walks the whole tree. */
const allActions = (): Array<{ noun: Noun; action: Noun['actions'][number] }> =>
    VERBS.flatMap((entry) => (entry.served === 'noun' ? entry.actions.map((action) => ({ noun: entry, action })) : []));

describe('the route', () => {
    test('answers 405 to anything but POST and 401 to an unknown token', async () => {
        const path = `${CANVAS_PATH}/help`;
        const deps = { targetForToken: () => null, host: host() };
        expect((await handleCanvasRequest(new Request(`http://127.0.0.1${path}`), path, deps)).status).toBe(405);
        expect((await post('help', [], 'nope')).status).toBe(401);
    });

    test('an unknown verb is a 404 refusal that points at help and lists the verbs and nouns', async () => {
        const { status, lines } = await post('spawn', ['claude']);
        expect(status).toBe(404);
        expect(lines[0]).toBe('refused\tunknown-verb\tspawn is not a verb or a noun');
        expect(lines[1]).toBe(HELP_LINE);
        expect(lines.slice(2)).toEqual(rootRows());
    });

    test('a spelling from before the nouns is an unknown verb like any other', async () => {
        for (const old of ['nodes', 'edges', 'views', 'rename', 'group', 'arrange', 'open', 'diagram', 'tasks']) {
            const { status, lines } = await post(old, []);
            expect(status).toBe(404);
            expect(lines[0]).toBe(`refused\tunknown-verb\t${old} is not a verb or a noun`);
            expect(lines[1]).toBe(HELP_LINE);
        }
    });

    test('a verb and its arguments quoted into one name is told what went wrong', async () => {
        const { status, lines } = await post('help agent', []);
        expect(status).toBe(404);
        expect(lines[0]).toBe('refused\tunknown-verb\thelp agent is not a verb or a noun');
        expect(lines[1]).toBe('note\tA verb and its arguments are separate words, so this is ruimte-context help agent, not one name');
        expect(lines[2]).toBe(HELP_LINE);
        expect(lines.slice(3)).toEqual(rootRows());
        expect((await post('node list', [])).lines[1]).toBe(
            'note\tA verb and its arguments are separate words, so this is ruimte-context node list, not one name'
        );
        // A name that starts with nothing this daemon knows gets the list and no guess.
        expect((await post('spawn team', [])).lines[1]).toBe(HELP_LINE);
    });

    test('a body without argv is refused', async () => {
        const path = `${CANVAS_PATH}/help`;
        const response = await handleCanvasRequest(
            new Request(`http://127.0.0.1${path}`, { method: 'POST', headers: { authorization: 'Bearer term' }, body: '{}' }),
            path,
            { targetForToken: (value) => TOKENS[value] ?? null, host: host() }
        );
        expect(response.status).toBe(422);
    });
});

describe('the tree', () => {
    test('a noun needs one of its actions, and says which they are', async () => {
        for (const noun of ['node', 'link', 'task']) {
            const entry = nounNamed(noun);
            const words = entry.actions.map((action) => action.word).join(', ');
            const bare = await post(noun, []);
            expect(bare.status).toBe(422);
            expect(bare.lines).toEqual([
                `refused\tunknown-action\t${noun} needs one of ${words}`,
                ...entry.actions.map((action) => `usage\t${action.name}\t${action.usage}`),
                `detail\truimte-context help ${noun}`
            ]);
        }
        // A kind where the action goes, or a flag, is not an action either: node <kind> and a bare link are gone.
        expect((await post('node', ['note', '--text', 'x'])).lines[0]).toBe(
            'refused\tunknown-action\tnode needs one of list, new, edit, rename, delete, group, arrange, and note is not one'
        );
        expect((await post('link', ['--to', 'note-1'])).lines[0]).toBe('refused\tunknown-action\tlink needs one of list, new, delete, and --to is not one');
    });

    test('the nouns hold the actions the grammar names, in that order', () => {
        const words = (noun: string): string[] => nounNamed(noun).actions.map((action) => action.word);
        expect(words('node')).toEqual(['list', 'new', 'edit', 'rename', 'delete', 'group', 'arrange']);
        expect(words('link')).toEqual(['list', 'new', 'delete']);
        expect(words('view')).toEqual(['list', 'new', 'rename', 'icon', 'move', 'delete', 'open', 'diagram']);
        expect(words('task')).toEqual(['list', 'new']);
        expect(words('worktree')).toEqual(['list', 'diff', 'merge']);
        expect(VERBS.filter((entry) => entry.served !== 'noun').map((entry) => entry.name)).toEqual([
            'help',
            'list',
            'read',
            'done',
            'notify',
            'agent',
            'team'
        ]);
        for (const { noun, action } of allActions()) {
            expect(action.name).toBe(`${noun.name} ${action.word}`);
        }
    });

    test('an argument refusal of an action names both words and points at its own help', async () => {
        const { lines } = await post('link', ['list', 'main']);
        expect(lines).toEqual([
            'refused\tbad-arguments\tlink list takes no arguments, only flags',
            'usage\tlink list\t[--view V]',
            'detail\truimte-context help link list'
        ]);
    });
});

describe('help', () => {
    test('renders one row per verb and noun from the registry, with what is neither marked as such', async () => {
        const { status, lines } = await post('help', []);
        expect(status).toBe(200);
        expect(lines.slice(0, -7)).toEqual(rootRows());
        expect(lines.map((line) => line.split('\t')[0])).toEqual([
            ...VERBS.map((entry) => (entry.served === 'noun' ? 'noun' : 'verb')),
            'scope',
            'ids',
            'dry run',
            'detail',
            'detail',
            'detail',
            'refusal'
        ]);
        expect(lines[2]).toBe('verb\tread\t<id> [--tail N] [--subagent T]\tPrints one linked source, whole or its last lines.');
        expect(lines).toContain(
            'noun\tnode\tlist|new|edit|rename|delete|group|arrange\tLists, adds, writes in, renames, removes, frames and lays out the nodes of a canvas'
        );
        expect(lines.at(-7)).toStartWith('scope\tlist and read are what a person linked into this session;');
        expect(lines.at(-6)).toBe('ids\tIds in this output are for your commands. When you talk to the person, name things by their title, never by id');
        expect(lines.at(-5)).toBe(
            'dry run\t--dry-run\tnode new, agent, plan new, team\tsame checks, nothing made; a refused call makes nothing either, so it is only a preview and never needed for safety; every other verb refuses the flag'
        );
        expect(lines.slice(-4, -1)).toEqual([
            'detail\truimte-context help <noun>\tthe signature of every action of a noun',
            'detail\truimte-context help <noun> <action>\tone action in full',
            'detail\truimte-context help <verb>\tone verb in full'
        ]);
        expect(lines.at(-1)).toBe(
            'refusal\trefused<TAB><code><TAB><message> on stderr, then what you can pick instead\texit 0 done, 1 the daemon failed, 2 not in a live Ruimte session, 3 refused'
        );
    });

    test('the root names every noun and every verb of its own, and no action by its arguments', async () => {
        const { lines } = await post('help', []);
        for (const noun of ['node', 'link', 'view', 'task', 'plan', 'worktree']) {
            expect(lines.filter((line) => line.startsWith(`noun\t${noun}\t`))).toHaveLength(1);
        }
        for (const verb of ['help', 'list', 'read', 'done', 'notify', 'agent', 'team']) {
            expect(lines.filter((line) => line.startsWith(`verb\t${verb}\t`))).toHaveLength(1);
        }
        expect(lines.some((line) => line.includes('--text B'))).toBe(false);
    });

    test('help <verb> details one verb, synopsis first and refusals last', async () => {
        for (const verb of VERBS) {
            if (verb.served === 'noun') {
                continue;
            }
            const { status, lines } = await post('help', [verb.name]);
            expect(status).toBe(200);
            expect(lines[0]).toBe(`usage\t${verb.name}\t${verb.usage}`);
            expect(lines[1]).toBe(`about\t${verb.summary}`);
            expect(lines.slice(2, -1)).toEqual([...verb.detail]);
            expect(lines.at(-1)).toStartWith('refusal\t');
            // Tab-separated rows, never a paragraph.
            expect(lines.every((line) => line.includes('\t'))).toBe(true);
        }
    });

    test('help <noun> prints the signature of every action and no action in full', async () => {
        for (const noun of VERBS) {
            if (noun.served !== 'noun') {
                continue;
            }
            const { status, lines } = await post('help', [noun.name]);
            expect(status).toBe(200);
            expect(lines).toEqual([
                `usage\t${noun.name}\t${noun.usage}`,
                `about\t${noun.summary}`,
                ...noun.detail,
                ...noun.actions.map((action) => `action\t${action.name}\t${action.usage}\t${action.summary}`),
                `detail\truimte-context help ${noun.name} <action>\tone action in full`,
                lines.at(-1)!
            ]);
            expect(lines.at(-1)).toStartWith('refusal\t');
        }
    });

    test('help <noun> <action> details one action, synopsis first and refusals last', async () => {
        for (const { action } of allActions()) {
            const { status, lines } = await post('help', action.name.split(' '));
            expect(status).toBe(200);
            expect(lines[0]).toBe(`usage\t${action.name}\t${action.usage}`);
            expect(lines[1]).toBe(`about\t${action.summary}`);
            expect(lines.slice(2, -1)).toEqual([...action.detail]);
            expect(lines.at(-1)).toStartWith('refusal\t');
            expect(lines.every((line) => line.includes('\t'))).toBe(true);
        }
    });

    test('every flag a verb or an action takes is a line of its own detail', async () => {
        const entries = [
            ...VERBS.flatMap((entry) => (entry.served === 'canvas' ? [{ words: [entry.name], flagNames: entry.flagNames }] : [])),
            ...allActions().map(({ action }) => ({ words: action.name.split(' '), flagNames: action.flagNames }))
        ];
        for (const { words, flagNames } of entries) {
            const { lines } = await post('help', words);
            for (const flag of flagNames) {
                expect({ words, flag, found: lines.some((line) => line.startsWith(`flag\t--${flag} `) || line.startsWith(`flag\t--${flag}\t`)) }).toEqual({
                    words,
                    flag,
                    found: true
                });
            }
        }
    });

    test('every flag of a detail is in the usage help <noun> and a refusal print, and the usage names no flag the parser lacks', async () => {
        const entries = [...VERBS.flatMap((entry) => (entry.served === 'canvas' ? [entry] : [])), ...allActions().map(({ action }) => action)];
        for (const { name, usage, detail, flagNames } of entries) {
            const documented = detail.filter((line) => line.startsWith('flag\t--')).map((line) => line.split('\t')[1]!.split(' ')[0]!);
            const spelled = [...usage.matchAll(/(?:^|[^\w-])--([\w-]+)/g)].map((match) => match[1]!);
            expect({ name, missing: documented.filter((flag) => !spelled.includes(flag.slice(2))) }).toEqual({ name, missing: [] });
            expect({ name, unknown: spelled.filter((flag) => !flagNames.includes(flag)) }).toEqual({ name, unknown: [] });
        }
        expect(nounNamed('plan').actions.find((action) => action.word === 'new')!.usage).toContain('[--document JSON]');
        expect((await post('help', ['view'])).lines.some((line) => line.startsWith('action\tview rename\t<viewId> <name> [--revision N]\t'))).toBe(true);
        expect((await post('view', ['rename', 'board'])).lines).toContain('usage\tview rename\t<viewId> <name> [--revision N]');
    });

    test('help node new says what it prints, which flag goes with which kind, and where a node lands', async () => {
        const { lines } = await post('help', ['node', 'new']);
        expect(lines).toContain(
            'prints\tid\tkind\tview\tedge\tthe id of the new node, its kind, the canvas it landed on and the id of the line drawn from you into it (- when none was drawn)'
        );
        expect(lines).toContain('kind\tnote\t--text\tcalled "Note" without --title');
        expect(lines).toContain('kind\tbrowser\t--url (required)\tcalled "Browser" without --title');
        expect(lines).toContain('kind\tevery kind\t--title T, --view V, --beside N');
        expect(lines).toContain('flag\t--url U\tbrowser (required)\tAn http or https address');
        expect(lines).toContain('flag\t--cwd P\tterminal, chat\tThe directory the shell starts in');
        expect(lines).toContain('kind\tdiagram\t--source (required)\tcalled the name of the diagram view without --title');
        expect(lines.filter((line) => line.startsWith('where\t')).length).toBe(2);
        expect(lines.filter((line) => line.startsWith('paths\t')).length).toBe(2);
        expect(lines.some((line) => line.includes('--text - takes the body from stdin'))).toBe(true);
        // What the line into a new node means, which differs per kind and is on no canvas to read.
        expect(lines.some((line) => line.startsWith('edge\t') && line.includes('that line is context'))).toBe(true);
        expect(lines.some((line) => line.startsWith('edge\t') && line.includes('lets you read that node'))).toBe(true);
        expect(lines.some((line) => line.startsWith('edge\t') && line.includes('the edge column shows -'))).toBe(true);
        expect(lines.some((line) => line.startsWith('flag\t--dry-run\t') && line.includes('<from> -> <new node>'))).toBe(true);
    });

    test('help agent covers what a first-time caller cannot see from the canvas', async () => {
        const { lines } = await post('help', ['agent']);
        expect(lines).toContain(
            'prints\tid\tkind\tview\tcli\tedge\ttask\tthe new node, its kind (chat or terminal), the canvas it landed on, the CLI it runs, the id of the edge drawn into it (- when none was drawn) and, with --task, the id of the task'
        );
        // Which CLIs open as a chat, from the registry rather than from a sentence that can drift.
        expect(lines.some((line) => line.startsWith('flag\t--terminal\t') && line.includes('claude, codex'))).toBe(true);
        expect(lines.some((line) => line.startsWith('flag\t--prompt T\t') && line.includes(String(MAX_PROMPT_LENGTH)))).toBe(true);
        expect(lines.some((line) => line.startsWith('paths\t') && line.includes('worktree'))).toBe(true);
        expect(lines.some((line) => line.startsWith('without a prompt\t'))).toBe(true);
        expect(lines.some((line) => line.startsWith('edge\t') && line.includes('One way only') && line.includes('ruimte-context link new'))).toBe(true);
        expect(lines.some((line) => line.startsWith('groups\t') && line.includes('ruimte-context node list'))).toBe(true);
        // An apostrophe in a prompt is where a shell eats the argument, which no refusal can explain afterwards.
        expect(lines.some((line) => line.startsWith('quoting\t') && line.includes("'\\''"))).toBe(true);
        expect(lines.some((line) => line.startsWith('flag\t--title T\t') && line.includes(String(MAX_TITLE_LENGTH)))).toBe(true);
    });

    test('help team answers what its own output cannot say', async () => {
        const { lines } = await post('help', ['team']);
        expect(lines).toContain(
            'prints\tid\tkind\ttitle\tview\tcli\tedge\ttask\tthe group first, its label in the title column and a dash for the CLI and the edge, then one line per role in the order of --roles, with the id of its task last under --task; the title is what tells two rows of one CLI apart'
        );
        // The way back into a role's work, which agent says and team did not.
        expect(lines.some((line) => line.startsWith('edges\t') && line.includes('ruimte-context link new --to'))).toBe(true);
        // Which CLIs open a chat role, from the registry rather than from a phrase that can drift.
        expect(lines.some((line) => line.startsWith('roles\tterminal\t') && line.includes('claude, codex'))).toBe(true);
        expect(lines.some((line) => line.startsWith('depth\t') && line.includes(`A role lands at depth ${MAX_TEAM_DEPTH}`) && line.includes('agent'))).toBe(
            true
        );
        expect(lines.some((line) => line.startsWith('flag\t--label L\t') && line.includes(String(MAX_TITLE_LENGTH)))).toBe(true);
        expect(lines.some((line) => line.startsWith('roles\ttitle\t') && line.includes(String(MAX_TITLE_LENGTH)))).toBe(true);
        expect(lines.some((line) => line.startsWith('titles\t') && line.includes('never unique'))).toBe(true);
        expect(lines.some((line) => line.startsWith('quoting\t') && line.includes("'\\''") && line.includes('\\u0027'))).toBe(true);
        expect(lines.some((line) => line.startsWith('flag\t--dry-run\t') && line.includes("<from> -> <the role's title>"))).toBe(true);
    });

    test('help link new says what its label may be', async () => {
        const { lines } = await post('help', ['link', 'new']);
        expect(lines.some((line) => line.startsWith('flag\t--label L\t') && line.includes(String(MAX_TITLE_LENGTH)))).toBe(true);
    });

    test('everything that draws or lists a line points at link list', async () => {
        for (const words of [['agent'], ['team'], ['link', 'new'], ['node', 'list'], ['link', 'delete']]) {
            const { lines } = await post('help', words);
            expect(lines.some((line) => line.includes('ruimte-context link list'))).toBe(true);
        }
        const { lines } = await post('help', ['team']);
        expect(lines.some((line) => line.startsWith('edges\t') && line.includes('One way only'))).toBe(true);
        expect(lines.some((line) => line.startsWith('example\t') && line.includes('--roles'))).toBe(true);
    });

    test('the verbs about linked context and the actions about the canvas are told apart wherever they meet', async () => {
        for (const words of [['list'], ['read'], ['node', 'list']]) {
            const scope = (await post('help', words)).lines.filter((line) => line.startsWith('scope\t'));
            expect(scope).toHaveLength(1);
            expect(scope[0]).toInclude('a node you add is readable through read only once a line joins it to you, and a terminal or a chat only once');
        }
    });

    test('help read says what comes back for every kind a source can be', async () => {
        const { lines } = await post('help', ['read']);
        for (const kind of ContextSourceSchema.shape.kind.options) {
            expect(lines.some((line) => line.startsWith(`kind\t${kind}\t`))).toBe(true);
        }
        expect(lines.some((line) => line.startsWith('kind\tterminal\t') && line.includes(String(MAX_SCREEN_LINES)))).toBe(true);
        expect(lines.some((line) => line.startsWith('kind\tfile\t') && line.includes('read it yourself'))).toBe(true);
    });

    test('help node list says which row the caller is, and names the variable that says it too', async () => {
        const self = (await post('help', ['node', 'list'])).lines.filter((line) => line.startsWith('self\t'));
        expect(self).toHaveLength(2);
        expect(self[0]).toInclude('self and your own id');
        expect(self[1]).toInclude('$RUIMTE_SESSION_ID');
        expect(SESSION_VARIABLES).toContain('RUIMTE_SESSION_ID');
        // A chat backend is spawned without it, and help must not send one looking for what it never got.
        expect(self[1]).toInclude('a chat backend is given none');
    });

    test('help view list says a separator has no name', async () => {
        expect((await post('help', ['view', 'list'])).lines).toContain('note\tA separator is a line in the sidebar and has an empty name');
    });

    test('a verb or noun it does not have is refused with the list', async () => {
        const { status, lines } = await post('help', ['spawn']);
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tunknown-verb\tspawn is not a verb or a noun');
        expect(lines.slice(1)).toEqual([HELP_LINE, ...rootRows()]);
        expect((await post('help', ['nodes'])).lines[0]).toBe('refused\tunknown-verb\tnodes is not a verb or a noun');
    });

    test('an action a noun does not have is refused with the actions it does', async () => {
        const { status, lines } = await post('help', ['link', 'draw']);
        expect(status).toBe(422);
        expect(lines).toEqual([
            'refused\tunknown-action\tdraw is not an action of link',
            ...nounNamed('link').actions.map((action) => `action\t${action.name}\t${action.usage}\t${action.summary}`)
        ]);
        expect((await post('help', ['agent', 'claude'])).lines).toEqual([
            'refused\tbad-arguments\tagent is a verb and has no actions; ruimte-context help agent details it',
            'detail\truimte-context help agent\tone verb in full'
        ]);
    });

    test('list and read are named there but not run by the canvas route', async () => {
        for (const verb of ['list', 'read']) {
            const { status, lines } = await post(verb, []);
            expect(status).toBe(404);
            expect(lines).toEqual([`refused\tnot-a-canvas-verb\t${verb} is answered by GET /context; run ruimte-context ${verb}`]);
        }
    });

    test('refuses arguments it does not take', async () => {
        expect((await post('help', ['--view', 'main'])).lines[0]).toStartWith('refused\tunknown-flag\t');
        const extra = await post('help', ['node', 'list', 'x']);
        expect(extra.lines).toEqual([
            'refused\tbad-arguments\thelp takes a verb, or a noun and one of its actions, and nothing else',
            'usage\thelp\t[noun] [action]',
            'detail\truimte-context help help'
        ]);
    });
});

describe('refusals', () => {
    test('say what is missing and, for a closed set, what may go there', async () => {
        const cases: Array<{ verb: string; argv: string[]; code: string; message: string }> = [
            { verb: 'node new', argv: [], code: 'bad-arguments', message: 'node new needs a kind: note, browser, drawing, diagram, file, terminal, chat' },
            {
                verb: 'node new',
                argv: ['group'],
                code: 'bad-arguments',
                message: 'node new needs a kind: note, browser, drawing, diagram, file, terminal, chat'
            },
            {
                verb: 'node new',
                argv: ['note', 'My note'],
                code: 'bad-arguments',
                message: 'node new takes one kind and nothing else; a title goes in --title'
            },
            { verb: 'node new', argv: ['note', '--title='], code: 'bad-arguments', message: '--title needs a title' },
            { verb: 'node new', argv: ['note', '--view='], code: 'bad-arguments', message: '--view needs the id of a canvas' },
            { verb: 'node new', argv: ['note', '--beside='], code: 'bad-arguments', message: '--beside needs the id of a node on that canvas' },
            { verb: 'node list', argv: ['main'], code: 'bad-arguments', message: 'node list takes no arguments, only flags' },
            { verb: 'view list', argv: ['all'], code: 'bad-arguments', message: 'view list takes no arguments' },
            {
                verb: 'node new',
                argv: ['note', '--cmd', 'ls'],
                code: 'unknown-flag',
                message: '--cmd is not one of --title, --text, --url, --path, --source, --cwd, --view, --beside, --revision, --dry-run'
            },
            { verb: 'view list', argv: ['--view', 'main'], code: 'unknown-flag', message: '--view is not a flag here; this verb takes none' },
            {
                verb: 'node new',
                argv: ['note', '--text'],
                code: 'missing-value',
                message: '--text needs a value (write --text=<value> for one that starts with --)'
            },
            { verb: 'node new', argv: ['note', '--title', 'a', '--title', 'b'], code: 'duplicate-flag', message: '--title is given twice' }
        ];
        for (const { verb, argv, code, message } of cases) {
            const [first, ...rest] = verb.split(' ');
            const { status, lines } = await post(first!, [...rest, ...argv]);
            expect({ argv, status, line: lines[0] }).toEqual({ argv, status: 422, line: `refused\t${code}\t${message}` });
            expect(lines).toContain(`detail\truimte-context help ${verb}`);
        }
    });

    test('name what can be picked instead wherever the set is closed', async () => {
        const missing = await post('node', ['new', 'browser']);
        expect(missing.lines).toEqual([
            'refused\tmissing-flag\tA browser node needs --url',
            'kind\tbrowser\t--url (required)\tcalled "Browser" without --title',
            'kind\tevery kind\t--title T, --view V, --beside N'
        ]);
        expect((await post('node', ['new', 'note', '--url', 'https://example.com'])).lines.slice(1)).toEqual([
            'kind\tnote\t--text\tcalled "Note" without --title',
            'kind\tevery kind\t--title T, --view V, --beside N'
        ]);
        expect((await post('node', ['new', 'note', '--beside', 'nope'])).lines).toEqual([
            'refused\tunknown-node\tnope is not a node on main',
            'node\tterm-1\tterminal\tshell',
            'node\tnote-1\tnote\tPlan with a tab'
        ]);
    });

    test('a canvas too full to list points at the verb that lists it', async () => {
        const full = content();
        const board = full.views[2] as ProjectCanvasView;
        board.nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n-${i}`, kind: 'note' as const, title: 'n', x: i * 400, y: 0, w: 320, h: 240 }));
        await store.mutate(projectId, () => ({ content: full, result: null }));
        expect((await post('node', ['new', 'note', '--view', 'board', '--beside', 'nope'])).lines).toEqual([
            'refused\tunknown-node\tnope is not a node on board',
            'detail\truimte-context node list\tthe 30 nodes of board'
        ]);
    });

    test('say what is allowed where no set can be listed', async () => {
        const cases: Array<{ argv: string[]; code: string; says: string }> = [
            { argv: ['browser', '--url', 'not a url'], code: 'bad-url', says: 'http or https address' },
            { argv: ['browser', '--url', 'file:///etc/passwd'], code: 'bad-url', says: 'browser node opens nothing else' },
            { argv: ['file', '--path', 'src/missing.ts'], code: 'bad-path', says: 'resolved against the project folder' },
            { argv: ['terminal', '--cwd', 'nope'], code: 'bad-cwd', says: 'resolved against the project folder' }
        ];
        for (const { argv, code, says } of cases) {
            const { lines } = await post('node', ['new', ...argv]);
            expect(lines[0]).toStartWith(`refused\t${code}\t`);
            expect(lines[0]).toInclude(says);
            // Nothing is invented: a path or an address has no list to pick from.
            expect(lines).toHaveLength(1);
        }
    });

    test('never leak a message out of zod', async () => {
        const argvPerVerb: Record<string, string[][]> = {
            help: [['nope', 'nope']],
            'node list': [['x'], ['--view=']],
            'view list': [['x']],
            'node new': [[], ['x'], ['note', 'x'], ['note', '--path=']]
        };
        for (const [verb, cases] of Object.entries(argvPerVerb)) {
            for (const argv of cases) {
                const [first, ...rest] = verb.split(' ');
                const message = (await post(first!, [...rest, ...argv])).lines[0]!.split('\t')[2]!;
                expect(message).not.toStartWith('Too ');
                expect(message).not.toStartWith('Invalid ');
                expect(message).not.toInclude('expected');
            }
        }
    });
});

describe('a closed set that is empty', () => {
    test('says so instead of listing nothing', async () => {
        const noGroups = await post('agent', ['claude', '--group', 'note-1']);
        expect(noGroups.lines[0]).toBe('refused\tunknown-group\tnote-1 is not a group on main');
        expect(noGroups.lines.slice(1)).toEqual(['note\tmain has no groups on it yet; team opens one of its own, and a person groups nodes on the canvas']);

        const noNodes = await post('node', ['new', 'note', '--text', 'x', '--view', 'board', '--beside', 'ghost']);
        expect(noNodes.lines).toEqual(['refused\tunknown-node\tghost is not a node on board', 'note\tboard has no nodes on it yet']);

        const empty = content();
        empty.views = [{ kind: 'chat', id: 'chat-1', name: 'Planner', node: {} }];
        await store.mutate(projectId, () => ({ content: empty, result: null }));
        const noCanvas = await post('node', ['new', 'note', '--text', 'x'], 'chat');
        expect(noCanvas.lines).toEqual([`refused\tview-required\t${OPENING_OFF_CANVAS}`, 'note\tThis project has no canvas; a node only ever lands on one']);
    });

    test('a --source with no drawing view in the project says that too', async () => {
        const noDrawings = content();
        noDrawings.views = noDrawings.views.filter((view) => view.kind !== 'drawing');
        await store.mutate(projectId, () => ({ content: noDrawings, result: null }));
        const { lines } = await post('node', ['new', 'drawing', '--source', 'nowhere']);
        expect(lines).toEqual([
            'refused\tnot-a-drawing\tnowhere is not a drawing view of this project',
            'note\tThis project has no drawing views; a person makes one in the sidebar'
        ]);
    });
});

describe('scoping', () => {
    test('a caller no project places is refused', async () => {
        expect((await post('view', ['list'], 'stray')).lines).toEqual([
            'refused\tnot-in-project\tThis session is not a node or a view of any project on this machine'
        ]);
    });

    test('a node on a canvas works on that canvas by default', async () => {
        const { status, lines } = await post('node', ['list']);
        expect(status).toBe(200);
        expect(lines).toEqual([
            'term-1\tterminal\tshell\t0\t0\t560\t360\t',
            'note-1\tnote\tPlan with a tab\t0\t601\t320\t240\t',
            'self\tterm-1',
            'revision\t1'
        ]);
    });

    test('--view picks another canvas, where the caller is nobody', async () => {
        expect(await post('node', ['list', '--view', 'board'])).toEqual({ status: 200, lines: ['self\t-\tnone of these nodes is you', 'revision\t1'] });
    });

    test('a chat that is a view of its own needs --view, and hears which canvases there are', async () => {
        const { status, lines } = await post('node', ['list'], 'chat');
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tview-required\t');
        expect(lines.slice(1)).toEqual(CANVAS_LINES);
        expect((await post('node', ['new', 'note'], 'chat')).lines[0]).toStartWith('refused\tview-required\t');
        expect((await post('node', ['new', 'note', '--view', 'board'], 'chat')).status).toBe(200);
    });

    test('a --view that is not a canvas is refused with the canvases listed', async () => {
        for (const view of ['chat-1', 'sketch-1', 'missing']) {
            const { status, lines } = await post('node', ['list', '--view', view]);
            expect(status).toBe(422);
            expect(lines[0]).toStartWith('refused\tnot-a-canvas\t');
            expect(lines.slice(1)).toEqual(CANVAS_LINES);
        }
    });
});

describe('view list', () => {
    test('lists every view in sidebar order, a separator with an empty name', async () => {
        expect((await post('view', ['list'])).lines).toEqual([
            'main\tcanvas\tCanvas\tno\tyou are in it\t-',
            'sep-1\tseparator\t\tno\ta person made it\t-',
            'board\tcanvas\tBoard\tno\ta person made it\t-',
            'chat-1\tchat\tPlanner\tno\ta person made it\t-',
            'sketch-1\tdrawing\tSketch\tno\ta person made it\t-',
            // The view the caller stands in, which it can read nowhere else.
            'self\tmain',
            'revision\t1'
        ]);
        expect((await post('view', ['list'], 'chat')).lines.at(-2)).toBe('self\tchat-1');
    });

    test('the last column is whether view delete would remove that view for the caller', async () => {
        const mine = await made('Notes');
        expect(await deleteColumn()).toEqual({ main: 'no', 'sep-1': 'no', board: 'no', 'chat-1': 'no', 'sketch-1': 'no', [mine]: 'yes' });
    });

    test('a machine that frees every view says so in the column, except for the one the caller is in', async () => {
        deleteAnyView = true;
        // The caller is a node on main, so removing main would end the session that is asking.
        expect(await deleteColumn()).toEqual({ main: 'no', 'sep-1': 'yes', board: 'yes', 'chat-1': 'yes', 'sketch-1': 'yes' });
        // And the reason beside it, or a caller that made none of them reads its own yes as a mistake.
        expect(await deleteWhy()).toEqual({
            main: 'you are in it',
            'sep-1': 'this machine frees every view',
            board: 'this machine frees every view',
            'chat-1': 'this machine frees every view',
            'sketch-1': 'this machine frees every view'
        });
    });

    test('the reason names the maker of a view another caller made', async () => {
        const theirs = await made('Theirs', [], 'chat');
        expect((await deleteWhy())[theirs]).toBe('chat-1 made it');
        expect((await deleteWhy('chat'))[theirs]).toBe('yours');
    });

    test('a caller that is a view of its own may not remove the view it is', async () => {
        deleteAnyView = true;
        expect((await deleteColumn('chat'))['chat-1']).toBe('no');
    });
});

describe('link list', () => {
    test('lists the lines of a canvas, id, from, to and label', async () => {
        await post('link', ['new', '--to', 'note-1', '--label', 'plan']);
        await post('link', ['new', '--to', 'note-1', '--from', 'note-1']).catch(() => null);
        const { status, lines } = await post('link', ['list']);
        expect(status).toBe(200);
        const edges = (await canvasOnDisk()).edges;
        expect(lines).toEqual([...edges.map((edge) => [edge.id, edge.from, edge.to, edge.label ?? ''].join('\t')), 'revision\t2']);
        expect(lines[0]!.split('\t').slice(1)).toEqual(['term-1', 'note-1', 'plan']);
    });

    test('a canvas with no lines on it prints only the revision, and --view says which canvas', async () => {
        expect((await post('link', ['list'])).lines).toEqual(['revision\t1']);
        expect((await post('link', ['list', '--view', 'board'])).lines).toEqual(['revision\t1']);
        expect((await post('link', ['list', '--view', 'sketch-1'])).lines[0]).toBe('refused\tnot-a-canvas\tsketch-1 is not a canvas of this project');
        expect((await post('link', ['list', '--view', 'main'], 'chat')).lines).toEqual(['revision\t1']);
        expect((await post('link', ['list'], 'chat')).lines[0]).toStartWith('refused\tview-required\t');
    });

    test('reads only, so it takes no --dry-run', async () => {
        expect((await post('link', ['list', '--dry-run'])).lines[0]).toStartWith('refused\tno-dry-run\t');
    });
});

describe('--revision', () => {
    const revisionOf = (lines: string[]): number => Number(lines.at(-1)!.split('\t')[1]);

    test('a write decided on the revision a list printed goes through, and one decided before a change refuses and writes nothing', async () => {
        const decided = revisionOf((await post('node', ['list'])).lines);
        const first = await post('node', ['new', 'note', '--text', 'one', '--revision', String(decided)]);
        expect(first.status).toBe(200);
        const stale = await post('node', ['new', 'note', '--text', 'two', '--revision', String(decided)]);
        expect(stale.lines[0]).toBe(
            `refused\trev-conflict\tThe project is at revision ${decided + 1}, and this call was decided on ${decided}; read it again and decide anew.`
        );
        expect((await canvasOnDisk()).nodes.filter((node) => node.kind === 'note')).toHaveLength(2);
        expect((await onDisk()).rev).toBe(decided + 1);
    });

    test('a dry run checks it too, and a start refuses before it makes anything', async () => {
        const decided = revisionOf((await post('view', ['list'])).lines);
        await post('node', ['new', 'note']);
        expect((await post('node', ['new', 'note', '--dry-run', '--revision', String(decided)])).lines[0]).toStartWith('refused\trev-conflict\t');
        expect((await post('agent', ['claude', '--worktree', '--revision', String(decided)])).lines[0]).toStartWith('refused\trev-conflict\t');
        expect(madeWorktrees).toEqual([]);
    });

    test('takes only a whole number, and only on a verb that writes the project file', async () => {
        expect((await post('node', ['rename', 'note-1', '--title', 'Plan', '--revision', 'latest'])).lines[0]).toStartWith(
            'refused\tbad-arguments\t--revision takes'
        );
        expect((await post('node', ['list', '--revision', '1'])).lines[0]).toStartWith('refused\tunknown-flag\t');
        expect((await post('plan', ['read', '--revision', '1'])).lines[0]).toStartWith('refused\tunknown-flag\t');
        expect((await post('help', ['node', 'new'])).lines.some((line) => line.startsWith('flag\t--revision N\toptional\t'))).toBe(true);
        expect((await post('help', ['node', 'list'])).lines.some((line) => line.startsWith('revision\t'))).toBe(true);
    });
});

describe('node new', () => {
    test('adds a note beside the caller on a released project and prints its id', async () => {
        const { status, lines } = await post('node', ['new', 'note', '--text', 'hello']);
        expect(status).toBe(200);
        const [id, kind, viewId] = lines[0]!.split('\t');
        expect(id).toMatch(/^note-[0-9a-z]{8}$/);
        expect([kind, viewId]).toEqual(['note', 'main']);
        const document = await onDisk();
        expect(document.rev).toBe(2);
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === id);
        expect(node).toEqual({ id: id!, kind: 'note', title: 'Note', x: 560 + PLACEMENT_GAP, y: 0, ...NODE_SIZE.note, body: 'hello' });
        expect(store.index.locate(id!)).toEqual({ projectId, folder, canvasId: 'main' });
    });

    test('draws a line from the caller into what it made, context into an agent node and origin into anything else', async () => {
        const withFlow = content();
        withFlow.views.push({ kind: 'diagram', id: 'flow-1', name: 'Flow' });
        await store.mutate(projectId, () => ({ content: withFlow, result: null }));

        const cases: Array<{ argv: string[]; label?: string; role?: string }> = [
            { argv: ['note'], role: 'origin' },
            { argv: ['browser', '--url', 'https://example.com'], role: 'origin' },
            { argv: ['file', '--path', 'src/main.ts'], role: 'origin' },
            { argv: ['drawing', '--source', 'sketch-1'], role: 'origin' },
            { argv: ['diagram', '--source', 'flow-1'], role: 'origin' },
            { argv: ['terminal'], label: 'context' },
            { argv: ['chat'], label: 'context' }
        ];
        for (const { argv, label, role } of cases) {
            const [id, kind, view, edgeId] = (await post('node', ['new', ...argv])).lines[0]!.split('\t');
            expect({ argv, kind, view }).toEqual({ argv, kind: argv[0]!, view: 'main' });
            const edge = (await canvasOnDisk()).edges.find((candidate) => candidate.id === edgeId);
            // A line into a terminal or a chat is the one agent draws, label and all and no role of its own.
            expect({ argv, edge }).toEqual({
                argv,
                edge: {
                    id: edgeId!,
                    from: 'term-1',
                    to: id!,
                    ...(label === undefined ? {} : { label }),
                    ...(role === undefined ? {} : { role })
                }
            });
        }
    });

    test('a caller that is not a node on that canvas gets no line, and the edge column says so', async () => {
        const elsewhere = await post('node', ['new', 'note', '--view', 'board']);
        expect(elsewhere.lines[0]!.split('\t').slice(1)).toEqual(['note', 'board', '-']);

        // A chat that is a view of its own is a node on no canvas at all.
        const ofItsOwn = await post('node', ['new', 'note', '--view', 'board'], 'chat');
        expect(ofItsOwn.status).toBe(200);
        expect(ofItsOwn.lines[0]!.split('\t').slice(1)).toEqual(['note', 'board', '-']);
        expect((await canvasOnDisk('board')).edges).toEqual([]);
    });

    test('--dry-run names the line it would draw and leaves the canvas alone', async () => {
        expect((await post('node', ['new', 'terminal', '--dry-run'])).lines).toEqual([`dry-run\tterminal\tmain\tterm-1 -> ${NEW_NODE}`]);
        const canvas = await canvasOnDisk();
        expect(canvas.edges).toEqual([]);
        expect(canvas.nodes.map((node) => node.id)).toEqual(['term-1', 'note-1']);
    });

    test('--beside places right of a named node, and refuses one that is not on the canvas', async () => {
        const { lines } = await post('node', ['new', 'terminal', '--beside', 'note-1', '--title', 'Build']);
        const id = lines[0]!.split('\t')[0];
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === id)!;
        expect([node.x, node.y, node.title, node.titleSource]).toEqual([320 + PLACEMENT_GAP, 601, 'Build', 'user']);
        // chat-1 is a view of its own, which the refusal says rather than leaving it to be looked for.
        expect((await post('node', ['new', 'note', '--beside', 'chat-1'])).lines[0]).toBe(
            'refused\tnot-on-a-canvas\tchat-1 is a chat that is a view of its own, not a node on any canvas of this project, so the new node has nothing there to stand beside'
        );
        expect((await post('node', ['new', 'note', '--beside', 'ghost'])).lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
    });

    test('--beside wins over the row beside the caller, wherever the anchor sits', async () => {
        // Far left of everything and well below the caller: the first free spot on the caller's row is nowhere near it.
        const moved = content();
        (moved.views[0] as ProjectCanvasView).nodes[1]!.x = -4000;
        (moved.views[0] as ProjectCanvasView).nodes[1]!.y = 2400;
        await store.mutate(projectId, () => ({ content: moved, result: null }));

        const { lines } = await post('node', ['new', 'note', '--beside', 'note-1']);
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === lines[0]!.split('\t')[0])!;
        expect([node.x, node.y]).toEqual([-4000 + 320 + PLACEMENT_GAP, 2400]);
    });

    test('--text reads \\n, \\t and \\\\ and leaves every other backslash alone', async () => {
        const { lines } = await post('node', ['new', 'note', '--text', 'Line one\\nLine two\\tend\\\\d\\s']);
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === lines[0]!.split('\t')[0])!;
        expect(node.body).toBe('Line one\nLine two\tend\\d\\s');
    });

    test('needs a kind it knows', async () => {
        expect((await post('node', ['new'])).lines[0]).toStartWith('refused\tbad-arguments\t');
        expect((await post('node', ['new', 'group'])).lines[0]).toStartWith('refused\tbad-arguments\t');
        expect((await post('node', ['new', 'note', '--cmd', 'ls'])).lines[0]).toStartWith('refused\tunknown-flag\t');
    });

    test('refuses a flag that does not belong to the kind', async () => {
        const cases: string[][] = [
            ['note', '--url', 'https://example.com'],
            ['browser', '--url', 'https://example.com', '--text', 'x'],
            ['terminal', '--path', 'src/main.ts'],
            ['file', '--path', 'src/main.ts', '--cwd', 'src'],
            ['chat', '--source', 'sketch-1']
        ];
        for (const argv of cases) {
            expect((await post('node', ['new', ...argv])).lines[0]).toStartWith('refused\tflag-not-for-kind\t');
        }
    });

    test('a browser needs an http(s) URL', async () => {
        expect((await post('node', ['new', 'browser'])).lines[0]).toStartWith('refused\tmissing-flag\t');
        expect((await post('node', ['new', 'browser', '--url', 'file:///etc/passwd'])).lines[0]).toStartWith('refused\tbad-url\t');
        expect((await post('node', ['new', 'browser', '--url', 'not a url'])).lines[0]).toStartWith('refused\tbad-url\t');
        const { lines } = await post('node', ['new', 'browser', '--url', 'https://example.com/docs']);
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === lines[0]!.split('\t')[0])!;
        expect(node.url).toBe('https://example.com/docs');
    });

    test('a file stores its path relative to the folder, and an outside one absolute', async () => {
        expect((await post('node', ['new', 'file'])).lines[0]).toStartWith('refused\tmissing-flag\t');
        expect((await post('node', ['new', 'file', '--path', 'src/missing.ts'])).lines[0]).toStartWith('refused\tbad-path\t');
        expect((await post('node', ['new', 'file', '--path', 'src'])).lines[0]).toStartWith('refused\tbad-path\t');
        const inside = (await post('node', ['new', 'file', '--path', 'src/main.ts'])).lines[0]!.split('\t')[0];
        const absolute = (await post('node', ['new', 'file', '--path', join(outside, 'notes.md')])).lines[0]!.split('\t')[0];
        const nodes = (await canvasOnDisk()).nodes;
        expect(nodes.find((node) => node.id === inside)).toMatchObject({ path: 'src/main.ts', title: 'main.ts' });
        expect(nodes.find((node) => node.id === absolute)).toMatchObject({ path: join(outside, 'notes.md'), title: 'notes.md' });
    });

    test('a drawing needs a drawing view of the same project as its source', async () => {
        expect((await post('node', ['new', 'drawing'])).lines[0]).toStartWith('refused\tmissing-flag\t');
        const wrong = await post('node', ['new', 'drawing', '--source', 'board']);
        expect(wrong.lines).toEqual(['refused\tnot-a-drawing\tboard is not a drawing view of this project', 'drawing\tsketch-1\tSketch']);
        const { lines } = await post('node', ['new', 'drawing', '--source', 'sketch-1']);
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === lines[0]!.split('\t')[0])!;
        expect(node).toMatchObject({ viewId: 'sketch-1', title: 'Sketch' });
    });

    test('a diagram needs a diagram view of the same project as its source', async () => {
        const withFlow = content();
        withFlow.views.push({ kind: 'diagram', id: 'flow-1', name: 'Flow' });
        await store.mutate(projectId, () => ({ content: withFlow, result: null }));

        expect((await post('node', ['new', 'diagram'])).lines[0]).toStartWith('refused\tmissing-flag\t');
        // A drawing is not a diagram, even though both take --source.
        const wrongKind = await post('node', ['new', 'diagram', '--source', 'sketch-1']);
        expect(wrongKind.lines).toEqual(['refused\tnot-a-diagram\tsketch-1 is not a diagram view of this project', 'diagram\tflow-1\tFlow']);
        const unknown = await post('node', ['new', 'diagram', '--source', 'nowhere']);
        expect(unknown.lines[0]).toBe('refused\tnot-a-diagram\tnowhere is not a diagram view of this project');
        expect((await post('node', ['new', 'drawing', '--source', 'flow-1'])).lines[0]).toStartWith('refused\tnot-a-drawing\t');

        const { lines } = await post('node', ['new', 'diagram', '--source', 'flow-1']);
        const [id, kind] = lines[0]!.split('\t');
        expect(kind).toBe('diagram');
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === id)!;
        expect(node).toMatchObject({ kind: 'diagram', viewId: 'flow-1', title: 'Flow', w: 480, h: 360 });
    });

    test('a --source with no diagram view in the project says how to make one', async () => {
        const { lines } = await post('node', ['new', 'diagram', '--source', 'nowhere']);
        expect(lines).toEqual([
            'refused\tnot-a-diagram\tnowhere is not a diagram view of this project',
            'note\tThis project has no diagram views; ruimte-context view new --kind diagram makes one'
        ]);
    });

    test('a cwd lies inside the folder or a worktree of it', async () => {
        const { lines } = await post('node', ['new', 'chat', '--cwd', 'src']);
        expect(lines[0]).not.toStartWith('refused');
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === lines[0]!.split('\t')[0])!;
        // Stored portable, like every cwd the client saves.
        expect(node.cwd).toBe('./src');

        expect((await post('node', ['new', 'terminal', '--cwd', outside])).lines[0]).toStartWith('refused\tcwd-outside-project\t');
        expect((await post('node', ['new', 'terminal', '--cwd', '../elsewhere'])).lines[0]).toStartWith('refused\tcwd-outside-project\t');
        expect((await post('node', ['new', 'terminal', '--cwd', 'nope'])).lines[0]).toStartWith('refused\tbad-cwd\t');

        await symlink(outside, join(folder, 'escape'));
        expect((await post('node', ['new', 'terminal', '--cwd', 'escape'])).lines[0]).toStartWith('refused\tcwd-outside-project\t');

        worktrees = [worktree];
        expect((await post('node', ['new', 'terminal', '--cwd', worktree])).status).toBe(200);
    });

    test('a cwd outside names the folder and every worktree, so the next try needs no guessing', async () => {
        const bare = await post('node', ['new', 'terminal', '--cwd', outside]);
        expect(bare.lines).toEqual([`refused\tcwd-outside-project\t${outside} is outside ${folder} and the worktrees of its repository`, `folder\t${folder}`]);

        // git lists the checkout itself among the worktrees; the folder line already said that one.
        worktrees = [folder, worktree];
        const listed = await post('node', ['new', 'terminal', '--cwd', outside]);
        expect(listed.lines).toEqual([listed.lines[0]!, `folder\t${folder}`, `worktree\t${worktree}`]);
    });

    test('an id is unique across the whole project', async () => {
        const ids = new Set<string>();
        for (let i = 0; i < 20; i++) {
            ids.add((await post('node', ['new', 'note'])).lines[0]!.split('\t')[0]!);
        }
        expect(ids.size).toBe(20);
    });

    test('a full canvas is refused with what is on it and what was asked, and nothing is written', async () => {
        const full = content();
        const board = full.views[2] as ProjectCanvasView;
        board.nodes = Array.from({ length: MAX_CANVAS_NODES }, (_, i) => ({ id: `n-${i}`, kind: 'note' as const, title: 'n', x: i * 10, y: 0, w: 10, h: 10 }));
        await store.mutate(projectId, () => ({ content: full, result: null }));
        const before = await onDisk();
        for (const argv of [
            ['node', 'new', 'note'],
            ['agent', 'claude']
        ]) {
            expect((await post(argv[0]!, [...argv.slice(1), '--view', 'board'])).lines[0]).toBe(
                `refused\tcanvas-full\tBoard holds ${MAX_CANVAS_NODES} nodes and this would add 1 more; a canvas holds at most ${MAX_CANVAS_NODES}`
            );
        }
        // A team counts its group in with its roles, so the number it names is what it would really add.
        const roles = JSON.stringify([{ title: 'Lexer', prompt: 'go', provider: 'claude' }]);
        expect((await post('team', ['--label', 'Crew', '--roles', roles, '--view', 'board'])).lines[0]).toBe(
            `refused\tcanvas-full\tBoard holds ${MAX_CANVAS_NODES} nodes and this would add 2 more; a canvas holds at most ${MAX_CANVAS_NODES}`
        );
        expect((await onDisk()).rev).toBe(before.rev);
    });
});

describe('agent model selection', () => {
    test('a model alias selects that model for a chat, including its defaults', async () => {
        const result = await post('agent', ['codex', '--model', 'sol', '--prompt', 'implement']);
        expect(result.status).toBe(200);
        expect(started[0]?.selection).toEqual({ model: 'gpt-6-sol', options: { effort: 'medium', serviceTier: false } });
    });

    test('unknown and terminal models refuse before creating nodes, also in a dry run', async () => {
        const before = await onDisk();
        for (const tail of [[], ['--dry-run']]) {
            const unknown = await post('agent', ['codex', '--model', 'missing', ...tail]);
            expect(unknown.lines[0]).toStartWith('refused\tunknown-model\t');
            expect(unknown.lines.some((line) => line.includes('gpt-6-sol'))).toBe(true);
            const terminal = await post('agent', ['codex', '--terminal', '--model', 'sol', ...tail]);
            expect(terminal.lines[0]).toStartWith('refused\tmodel-needs-chat\t');
        }
        expect((await onDisk()).rev).toBe(before.rev);
        expect(started).toEqual([]);
    });

    test('each team role can choose a model and an invalid role creates nothing', async () => {
        const roles = [
            { title: 'Builder', prompt: 'build', provider: 'codex', model: 'sol' },
            { title: 'Reviewer', prompt: 'review', provider: 'codex', model: 'astra' }
        ];
        const before = await onDisk();
        const invalid = await post('team', ['--label', 'Team', '--roles', JSON.stringify([...roles, { ...roles[0], model: 'missing' }])]);
        expect(invalid.lines[0]).toStartWith('refused\tunknown-model\trole 2 (model):');
        expect((await onDisk()).rev).toBe(before.rev);
        expect(started).toEqual([]);
        expect((await post('team', ['--label', 'Team', '--roles', JSON.stringify(roles)])).status).toBe(200);
        expect(started.map((start) => start.selection?.model)).toEqual(['gpt-6-sol', 'gpt-6-astra']);
    });
});

describe('agent', () => {
    test('--terminal opens a terminal agent with an edge from the caller into it, and holds the prompt', async () => {
        const { status, lines } = await post('agent', ['claude', '--terminal', '--prompt', 'say hello']);
        expect(status).toBe(200);
        const [id, kind, viewId, cli, edgeId] = lines[0]!.split('\t');
        expect(id).toMatch(/^terminal-[0-9a-z]{8}$/);
        expect([kind, viewId, cli]).toEqual(['terminal', 'main', 'claude']);

        const canvas = await canvasOnDisk();
        const node = canvas.nodes.find((candidate) => candidate.id === id)!;
        expect([node.kind, node.title, node.provider, node.titleSource]).toEqual(['terminal', 'Claude Code', 'claude', undefined]);
        // Context flows from the edge's `from` into the agent at `to`, so the caller is what the new agent may read.
        expect(canvas.edges).toEqual([{ id: edgeId!, from: 'term-1', to: id!, label: 'context' }]);
        expect(held).toEqual([{ projectId, nodeId: id!, prompt: 'say hello' }]);
        // Started by the daemon, not by whichever client shows it first, where a client would start it.
        expect(started).toEqual([
            { projectId, nodeId: id!, openedBy: 'term-1', node: 'terminal', provider: 'claude', cwd: folder, runtimeMode: 'full-access' }
        ]);
        // The mode is on the node, so a client that starts it again after a reload starts the same line.
        expect(node.runtimeMode).toBe('full-access');
    });

    test('a CLI with a chat backend opens as a chat node fixed to its CLI', async () => {
        const { lines } = await post('agent', ['codex', '--title', 'Reviewer']);
        const [id, kind] = lines[0]!.split('\t');
        expect(kind).toBe('chat');
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === id)!;
        expect([node.provider, node.providerFixed, node.title, node.titleSource]).toEqual(['codex', true, 'Reviewer', 'user']);
        // Without a prompt it is still started: a chat registers and waits, a terminal runs its CLI at its own prompt.
        expect(started).toEqual([{ projectId, nodeId: id!, openedBy: 'term-1', node: 'chat', provider: 'codex', cwd: folder }]);
    });

    test('a CLI without a chat backend opens as a terminal, with or without --terminal', async () => {
        const plain = await post('agent', ['gemini']);
        const asked = await post('agent', ['gemini', '--terminal']);
        expect([plain.status, asked.status]).toEqual([200, 200]);
        expect([plain.lines[0]!.split('\t')[1], asked.lines[0]!.split('\t')[1]]).toEqual(['terminal', 'terminal']);
        expect(started.map((start) => start.node)).toEqual(['terminal', 'terminal']);
    });

    test('a CLI that is not installed is refused with the ones that are', async () => {
        installed = ['codex'];
        const { lines } = await post('agent', ['claude']);
        expect(lines[0]).toBe('refused\tcli-not-installed\tClaude Code is not installed on this machine');
        expect(lines.slice(1)).toEqual(['cli\tcodex\tCodex']);
        installed = [];
        expect((await post('agent', ['claude'])).lines.slice(1)).toEqual(['note\tNo agent CLI is installed on this machine']);
        expect((await onDisk()).rev).toBe(1);
    });

    test('--prompt and --prompt-file are refused together, and a prompt past the cap is refused', async () => {
        expect((await post('agent', ['claude', '--prompt', 'a', '--prompt-file', 'b'])).lines[0]).toStartWith('refused\tprompt-twice\t');
        expect((await post('agent', ['claude', '--prompt', '   '])).lines[0]).toStartWith('refused\tempty-prompt\t');
        const long = 'x'.repeat(MAX_PROMPT_LENGTH + 1);
        const refusal = await post('agent', ['claude', `--prompt=${long}`]);
        expect(refusal.lines[0]).toStartWith(`refused\tprompt-too-long\tThe prompt is ${MAX_PROMPT_LENGTH + 1} characters`);
        expect(held).toEqual([]);
    });

    test('--prompt-file is read by the daemon, inside the project folder only', async () => {
        await writeFile(join(folder, 'brief.md'), 'Fix the parser\n');
        const { lines } = await post('agent', ['claude', '--prompt-file', 'brief.md']);
        expect(held).toEqual([{ projectId, nodeId: lines[0]!.split('\t')[0]!, prompt: 'Fix the parser' }]);
        expect((await post('agent', ['claude', '--prompt-file', join(outside, 'notes.md')])).lines[0]).toStartWith('refused\tprompt-file-outside-project\t');
        expect((await post('agent', ['claude', '--prompt-file', 'nowhere.md'])).lines[0]).toStartWith('refused\tbad-prompt-file\t');
    });

    test('--group puts the node inside the group, and a collapsed one also takes its id', async () => {
        const withGroup = content();
        const canvas = withGroup.views[0] as ProjectCanvasView;
        canvas.nodes.push({ id: 'group-1', kind: 'group', title: 'Work', x: 2000, y: 0, w: 900, h: 800 });
        canvas.nodes.push({ id: 'group-2', kind: 'group', title: 'Folded', x: 5000, y: 0, w: 900, h: 39, collapsed: true, expandedHeight: 800, memberIds: [] });
        await store.mutate(projectId, () => ({ content: withGroup, result: null }));

        const open = await post('agent', ['claude', '--group', 'group-1']);
        const openId = open.lines[0]!.split('\t')[0]!;
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === openId)!;
        expect(node.x).toBe(2000 + 32);
        expect(node.y).toBe(0 + 40 + 32);
        // Its center falls inside the frame, which is what makes it a member of an open group.
        expect(node.x + node.w / 2).toBeLessThan(2000 + 900);

        const folded = await post('agent', ['claude', '--group', 'group-2']);
        const foldedId = folded.lines[0]!.split('\t')[0]!;
        const group = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === 'group-2')!;
        expect(group.memberIds).toEqual([foldedId]);
        expect(group.h).toBe(39);
        expect(group.expandedHeight).toBe(800);
    });

    test('a --group that is not a group of that canvas is refused with the groups', async () => {
        const withGroup = content();
        (withGroup.views[0] as ProjectCanvasView).nodes.push({ id: 'group-1', kind: 'group', title: 'Work', x: 2000, y: 0, w: 900, h: 800 });
        await store.mutate(projectId, () => ({ content: withGroup, result: null }));
        const { lines } = await post('agent', ['claude', '--group', 'note-1']);
        expect(lines[0]).toBe('refused\tunknown-group\tnote-1 is not a group on main');
        expect(lines.slice(1)).toEqual(['group\tgroup-1\tWork']);
        expect((await post('agent', ['claude', '--group', 'group-1', '--beside', 'note-1'])).lines[0]).toStartWith('refused\ttwo-places\t');
    });

    test('a caller that is not a node on the canvas gets no edge', async () => {
        const { lines } = await post('agent', ['claude', '--view', 'board'], 'chat');
        expect(lines[0]!.split('\t').slice(1)).toEqual(['chat', 'board', 'claude', '-']);
        expect((await canvasOnDisk('board')).edges).toEqual([]);
    });

    test('--cwd has to stay inside the project folder', async () => {
        expect((await post('agent', ['claude', '--cwd', outside])).lines[0]).toStartWith('refused\tcwd-outside-project\t');
        const { lines } = await post('agent', ['claude', '--cwd', 'src']);
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === lines[0]!.split('\t')[0])!;
        expect(node.cwd).toBe('./src');
        expect(started.map((start) => start.cwd)).toEqual([join(folder, 'src')]);
    });

    test('a write the store refuses leaves no held prompt and no lineage, and neither does a dry run', async () => {
        breakWrites = true;
        const { status, lines } = await post('agent', ['claude', '--prompt', 'say hello']);
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tproject-invalid\t');
        breakWrites = false;
        expect((await post('agent', ['claude', '--prompt', 'say hello', '--dry-run'])).status).toBe(200);
        expect((await onDisk()).rev).toBe(1);
        expect(held).toEqual([]);
        expect(started).toEqual([]);
        expect(lineage.openedCount('term-1')).toBe(0);
    });

    test('--reads draws a line from every node it names into the new agent', async () => {
        const { status, lines } = await post('agent', ['claude', '--prompt', 'read the note', '--reads', 'note-1']);
        expect(status).toBe(200);
        const [id, , , , edgeId] = lines[0]!.split('\t');
        const [row, readEdgeId, from, to] = lines[1]!.split('\t');
        expect([row, from, to]).toEqual(['reads', 'note-1', id!]);
        // Into the new agent, the direction that makes the note readable to it, and labelled like every line that lands in one.
        expect((await canvasOnDisk()).edges).toEqual([
            { id: edgeId!, from: 'term-1', to: id!, label: 'context' },
            { id: readEdgeId!, from: 'note-1', to: id!, label: 'context' }
        ]);
    });

    test('the lines of --reads are on the canvas before the agent is started', async () => {
        let drawn: string[][] = [];
        onStart = async () => {
            drawn = (await canvasOnDisk()).edges.map((edge) => [edge.from, edge.to]);
        };
        const { lines } = await post('agent', ['claude', '--prompt', 'read the note', '--reads', 'note-1']);
        const id = lines[0]!.split('\t')[0]!;
        // One write for the node, its lines and the start, so no first turn ever runs without them.
        expect(drawn).toEqual([
            ['term-1', id],
            ['note-1', id]
        ]);
    });

    test('--reads that names the caller is the line agent draws anyway, once', async () => {
        const { lines } = await post('agent', ['claude', '--reads', 'term-1']);
        const [id, , , , edgeId] = lines[0]!.split('\t');
        expect(lines[1]!.split('\t')).toEqual(['reads', edgeId!, 'term-1', id!]);
        expect((await canvasOnDisk()).edges).toEqual([{ id: edgeId!, from: 'term-1', to: id!, label: 'context' }]);
    });

    test('--reads refuses an id that is on no canvas and names the nodes that are', async () => {
        const { status, lines } = await post('agent', ['claude', '--reads', 'note-1,ghost']);
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
        expect(lines.slice(1)).toEqual(['node\tterm-1\tterminal\tshell', 'node\tnote-1\tnote\tPlan with a tab']);
        expect((await onDisk()).rev).toBe(1);
        expect(started).toEqual([]);
        expect(held).toEqual([]);
    });

    test('--reads refuses more than the cap and an empty id', async () => {
        const many = Array.from({ length: MAX_LINKS + 1 }, (_, i) => `n-${i}`).join(',');
        expect((await post('agent', ['claude', '--reads', many])).lines[0]).toStartWith('refused\ttoo-many-links\t');
        expect((await post('agent', ['claude', '--reads', 'note-1,'])).lines[0]).toStartWith('refused\tbad-arguments\t');
        expect((await onDisk()).rev).toBe(1);
    });
});

describe('the mode ceiling', () => {
    test("--mode wider than the caller is refused with a code and the caller's mode", async () => {
        modes = { 'chat-1': 'supervised' };
        const { status, lines } = await post('agent', ['claude', '--mode', 'full-access', '--view', 'board'], 'chat');
        expect(status).toBe(422);
        expect(lines[0]).toBe(
            'refused\tmode-above-parent\tYou run in supervised and --mode full-access is wider; an agent you open runs in your mode or a narrower one'
        );
        expect(lines.slice(1)).toEqual(['mode\tyou\tsupervised', 'mode\tsupervised\tallowed']);
        const team = await post(
            'team',
            ['--label', 'Crew', '--mode', 'auto', '--view', 'board', '--roles', JSON.stringify([{ provider: 'claude', title: 'One', prompt: 'a' }])],
            'chat'
        );
        expect(team.lines[0]).toStartWith('refused\tmode-above-parent\t');
        expect((await onDisk()).rev).toBe(1);
        expect((await post('agent', ['claude', '--mode', 'everything'])).lines[0]).toStartWith('refused\tbad-arguments\t--mode is one of supervised');
    });

    test('--mode at or under the caller is what the agent starts in', async () => {
        modes = { 'term-1': 'auto' };
        const chat = await post('agent', ['claude', '--mode', 'auto-accept-edits']);
        const terminal = await post('agent', ['codex', '--terminal', '--mode', 'auto']);
        expect(started.map((start) => [start.node, start.runtimeMode])).toEqual([
            ['chat', 'auto-accept-edits'],
            ['terminal', 'auto']
        ]);
        const nodes = (await canvasOnDisk()).nodes;
        expect(nodes.find((node) => node.id === terminal.lines[0]!.split('\t')[0])?.runtimeMode).toBe('auto');
        // A chat keeps its mode in its own thread, not on the node.
        expect(nodes.find((node) => node.id === chat.lines[0]!.split('\t')[0])?.runtimeMode).toBeUndefined();
    });

    test("a terminal agent takes the person's terminal mode narrowed to the caller, and a chat is left to the daemon", async () => {
        modes = { 'term-1': 'auto-accept-edits' };
        terminalPreference = 'full-access';
        await post('agent', ['claude', '--terminal']);
        terminalPreference = 'supervised';
        await post('agent', ['claude', '--terminal']);
        await post('agent', ['claude']);
        expect(started.map((start) => start.runtimeMode)).toEqual(['auto-accept-edits', 'supervised', undefined]);
        const roles = JSON.stringify([
            { provider: 'claude', title: 'One', prompt: 'a', terminal: true },
            { provider: 'claude', title: 'Two', prompt: 'b' }
        ]);
        started = [];
        await post('team', ['--label', 'Crew', '--mode', 'supervised', '--roles', roles]);
        expect(started.map((start) => [start.node, start.runtimeMode])).toEqual([
            ['terminal', 'supervised'],
            ['chat', 'supervised']
        ]);
    });
});

describe('--worktree', () => {
    test('outside a repository is refused, and so is --worktree beside --cwd or --branch without it', async () => {
        expect((await post('agent', ['claude', '--worktree'])).lines[0]).toStartWith('refused\tnot-a-repository\t');
        expect((await post('agent', ['claude', '--worktree', '--cwd', 'src'])).lines[0]).toStartWith('refused\tworktree-and-cwd\t');
        expect((await post('agent', ['claude', '--branch', 'x'])).lines[0]).toStartWith('refused\tbranch-needs-worktree\t');
        expect(
            (await post('team', ['--label', 'Crew', '--worktree', '--roles', JSON.stringify([{ provider: 'claude', title: 'One', prompt: 'a' }])])).lines[0]
        ).toStartWith('refused\tnot-a-repository\t');
        expect(madeWorktrees).toEqual([]);
    });

    test('every role gets a branch of its own named after it, clear of the branches there are', async () => {
        branches = ['main', 'lexer'];
        const roles = JSON.stringify([
            { provider: 'claude', title: 'Lexer', prompt: 'a' },
            { provider: 'claude', title: 'Lexer', prompt: 'b' },
            { provider: 'codex', title: 'Parser!', prompt: 'c' }
        ]);
        const { lines } = await post('team', ['--label', 'Crew', '--worktree', '--roles', roles]);
        expect(madeWorktrees.map((made) => made.branch)).toEqual(['lexer-2', 'lexer-3', 'parser']);
        const nodes = (await canvasOnDisk()).nodes;
        const ids = lines.slice(1).map((line) => line.split('\t')[0]);
        expect(ids.map((id) => nodes.find((node) => node.id === id)?.cwd)).toEqual(madeWorktrees.map((made) => made.path));
        expect(started.map((start) => start.cwd)).toEqual(madeWorktrees.map((made) => made.path));
        // The group means "every node made inside it starts here", which a team of worktrees is not.
        expect(nodes.find((node) => node.kind === 'group')?.worktree).toBeUndefined();
    });

    test('a single agent is named after its task, or takes the branch it is given', async () => {
        branches = ['main'];
        modes = { 'chat-1': 'full-access' };
        await post('agent', ['claude', '--worktree', '--task', 'Fix the lexer', '--prompt', 'go', '--view', 'board'], 'chat');
        await post('agent', ['claude', '--worktree', '--branch', 'feature/own']);
        expect(madeWorktrees.map((made) => made.branch)).toEqual(['fix-the-lexer', 'feature/own']);
    });

    test('a dry run makes no worktree, and a write the store refuses takes back the ones it made', async () => {
        branches = ['main'];
        expect((await post('agent', ['claude', '--worktree', '--dry-run'])).status).toBe(200);
        expect(madeWorktrees).toEqual([]);
        breakWrites = true;
        expect((await post('agent', ['claude', '--worktree'])).status).toBe(422);
        expect(removedWorktrees).toEqual(madeWorktrees.map((made) => made.path));
        expect(removedWorktrees).toHaveLength(1);
    });
});

describe('team', () => {
    test('a write the store refuses leaves no held prompt and no lineage for any role', async () => {
        breakWrites = true;
        const roles = JSON.stringify([
            { provider: 'claude', title: 'One', prompt: 'a' },
            { provider: 'codex', title: 'Two', prompt: 'b' }
        ]);
        const { status, lines } = await post('team', ['--label', 'Crew', '--roles', roles]);
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tproject-invalid\t');
        expect((await onDisk()).rev).toBe(1);
        expect(held).toEqual([]);
        expect(started).toEqual([]);
        expect(lineage.openedCount('term-1')).toBe(0);
    });

    const THREE = [
        { title: 'Lexer', prompt: 'fix the tokenizer', provider: 'claude', terminal: true },
        { title: 'Parser', prompt: 'fix the parser', provider: 'codex' },
        { title: 'Docs', prompt: 'write the docs', provider: 'gemini' }
    ];

    const args = (roles: unknown, label = 'Crew'): string[] => ['--label', label, '--roles', JSON.stringify(roles)];

    const many = (count: number): unknown[] => Array.from({ length: count }, (_, index) => ({ title: `R${index}`, prompt: 'go', provider: 'claude' }));

    test('opens an agent per role in a group, with an edge into each and every prompt held', async () => {
        const { status, lines } = await post('team', args(THREE));
        expect(status).toBe(200);
        expect(lines).toHaveLength(4);

        const [groupId, ...group] = lines[0]!.split('\t');
        expect(groupId).toMatch(/^group-[0-9a-z]{8}$/);
        expect(group).toEqual(['group', 'Crew', 'main', '-', '-']);
        const members = lines.slice(1).map((line) => line.split('\t'));
        // The title is the column that tells two roles of one CLI apart, which the order alone cannot.
        expect(members.map((fields) => fields.slice(1, 5))).toEqual([
            ['terminal', 'Lexer', 'main', 'claude'],
            ['chat', 'Parser', 'main', 'codex'],
            ['terminal', 'Docs', 'main', 'gemini']
        ]);

        const ids = members.map((fields) => fields[0]!);
        const canvas = await canvasOnDisk();
        const frame = canvas.nodes.find((node) => node.id === groupId)!;
        expect([frame.kind, frame.title]).toEqual(['group', 'Crew']);
        // An open group holds whatever has its center inside it, so there is nothing to spell out.
        expect(frame.memberIds).toBeUndefined();
        for (const id of ids) {
            const node = canvas.nodes.find((candidate) => candidate.id === id)!;
            expect(node.x + node.w / 2).toBeWithin(frame.x, frame.x + frame.w);
            expect(node.y + node.h / 2).toBeWithin(frame.y, frame.y + frame.h);
        }
        const chat = canvas.nodes.find((node) => node.id === ids[1])!;
        expect([chat.title, chat.titleSource, chat.provider, chat.providerFixed]).toEqual(['Parser', 'user', 'codex', true]);

        expect(canvas.edges.map((edge) => [edge.id, edge.from, edge.to, edge.label])).toEqual(
            ids.map((id, index) => [members[index]![5], 'term-1', id, 'context'])
        );
        expect(held).toEqual(ids.map((id, index) => ({ projectId, nodeId: id, prompt: THREE[index]!.prompt })));
        expect(started.map((start) => [start.nodeId, start.node, start.provider, start.openedBy, start.cwd])).toEqual([
            [ids[0], 'terminal', 'claude', 'term-1', folder],
            [ids[1], 'chat', 'codex', 'term-1', folder],
            [ids[2], 'terminal', 'gemini', 'term-1', folder]
        ]);
    });

    test('the agents stand beside each other inside the frame, never on top of one another', async () => {
        const { lines } = await post('team', args(many(MAX_ROLES)));
        const canvas = await canvasOnDisk();
        const placed = lines.slice(1).map((line) => canvas.nodes.find((node) => node.id === line.split('\t')[0])!);
        for (const node of placed) {
            for (const other of placed) {
                if (node === other) {
                    continue;
                }
                const over = node.x < other.x + other.w && other.x < node.x + node.w && node.y < other.y + other.h && other.y < node.y + node.h;
                expect(over).toBe(false);
            }
        }
        // Four to a row, so a full team stands in as many rows as it has fours.
        expect(new Set(placed.map((node) => node.y)).size).toBe(Math.ceil(MAX_ROLES / TEAM_COLUMNS));
        // The group went beside the caller rather than over the note below it.
        const frame = canvas.nodes.find((node) => node.id === lines[0]!.split('\t')[0])!;
        expect(frame.x).toBe(560 + PLACEMENT_GAP);
    });

    test('roles that are not JSON, too few or too many are refused with the shape', async () => {
        const broken = await post('team', ['--label', 'Crew', '--roles', '[{"title":]']);
        expect(broken.status).toBe(422);
        expect(broken.lines[0]).toStartWith('refused\tbad-roles-json\t--roles is not JSON: ');
        expect(broken.lines[1]).toBe(`roles\tshape\t${ROLES_SHAPE}`);

        // The number that came in, not only the one that fits: a refusal that counts is one a caller can act on.
        expect((await post('team', args(many(MAX_ROLES + 1)))).lines[0]).toBe(
            `refused\tbad-roles\t--roles has ${MAX_ROLES + 1} roles and a team takes at most ${MAX_ROLES}`
        );
        expect((await post('team', args([]))).lines[0]).toBe(`refused\tbad-roles\t--roles has no roles in it; a team is between 1 and ${MAX_ROLES} of them`);
        expect((await post('team', args('claude'))).lines[0]).toBe('refused\tbad-roles\t--roles is a JSON array of roles');
        expect((await onDisk()).rev).toBe(1);
    });

    test('a role that is wrong is named by its place in the array', async () => {
        const cases: Array<[unknown, string]> = [
            [[THREE[0], { title: 'Parser', provider: 'codex' }], 'role 1 (prompt): prompt says what this agent starts working on'],
            [[{ title: 'Lexer', prompt: 'go', provider: 'kimi' }], `role 0 (provider): provider needs a CLI: ${AGENT_KINDS.join(', ')}`],
            [[{ prompt: 'go', provider: 'claude' }], 'role 0 (title): title needs a name for the node'],
            [[THREE[0], { title: 'Parser', prompt: 'go', provider: 'codex', terminal: 'yes' }], 'role 1 (terminal): terminal is true or false'],
            [[{ title: 'Lexer', prompt: 'go', provider: 'claude', chat: true }], 'role 0: Unrecognized key: "chat"'],
            [[{ title: 'Lexer', prompt: 'go', provider: 'claude', cwd: 'src' }], 'role 0: Unrecognized key: "cwd"'],
            [
                [{ title: 'Lexer', prompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1), provider: 'claude' }],
                `role 0 (prompt): prompt is ${MAX_PROMPT_LENGTH + 1} characters and at most ${MAX_PROMPT_LENGTH} fit on the line a CLI is started with`
            ],
            [
                [{ title: 'L'.repeat(MAX_TITLE_LENGTH + 1), prompt: 'go', provider: 'claude' }],
                `role 0 (title): title is ${MAX_TITLE_LENGTH + 1} characters and at most ${MAX_TITLE_LENGTH} fit in a name on the canvas`
            ]
        ];
        for (const [roles, message] of cases) {
            expect((await post('team', args(roles))).lines[0]).toBe(`refused\tbad-roles\t${message}`);
        }
        expect(held).toEqual([]);
        expect((await onDisk()).rev).toBe(1);
    });

    test('a role for a CLI that is not here is refused by index', async () => {
        installed = ['claude'];
        const gone = await post('team', args(THREE));
        expect(gone.lines[0]).toBe('refused\tcli-not-installed\trole 1 (codex): Codex is not installed on this machine');
        expect(gone.lines.slice(1)).toEqual(['cli\tclaude\tClaude Code']);
        expect((await onDisk()).rev).toBe(1);
    });

    test('--cwd goes to every role and has to stay inside the project folder', async () => {
        expect((await post('team', [...args(THREE), '--cwd', outside])).lines[0]).toStartWith('refused\tcwd-outside-project\t');
        const { lines } = await post('team', [...args(THREE), '--cwd', 'src']);
        const canvas = await canvasOnDisk();
        for (const line of lines.slice(1)) {
            expect(canvas.nodes.find((node) => node.id === line.split('\t')[0])!.cwd).toBe('./src');
        }
    });

    test('a caller that is not a node on the canvas gets a team without edges', async () => {
        // Without --view a chat that is a view of its own is told both halves: name a canvas, and no edge comes with it.
        for (const verb of [
            ['team', ...args(THREE)],
            ['agent', 'claude']
        ]) {
            const refused = await post(verb[0]!, verb.slice(1), 'chat');
            expect(refused.lines[0]).toBe(`refused\tview-required\t${OPENING_OFF_CANVAS}`);
        }
        const { lines } = await post('team', [...args(THREE), '--view', 'board'], 'chat');
        expect(lines.every((line) => line.split('\t')[3] === 'board')).toBe(true);
        // No caller on that canvas, so no edge to name in the last column either.
        expect(lines.every((line) => line.split('\t')[5] === '-')).toBe(true);
        expect((await canvasOnDisk('board')).edges).toEqual([]);
        expect(held).toHaveLength(3);
    });

    test('--dry-run names every role it would open and writes nothing', async () => {
        const { status, lines } = await post('team', [...args(THREE), '--dry-run']);
        expect(status).toBe(200);
        expect(lines).toEqual([
            'dry-run\tgroup\tCrew\tmain\t-\t-',
            'dry-run\tterminal\tLexer\tmain\tclaude\tterm-1 -> <Lexer>',
            'dry-run\tchat\tParser\tmain\tcodex\tterm-1 -> <Parser>',
            'dry-run\tterminal\tDocs\tmain\tgemini\tterm-1 -> <Docs>'
        ]);
        expect((await onDisk()).rev).toBe(1);
        expect(held).toEqual([]);
        expect(lineage.openedCount('term-1')).toBe(0);
    });

    test('two roles of one CLI are two rows a reader can tell apart', async () => {
        const pair = [
            { title: 'Lexer', prompt: 'fix the tokenizer', provider: 'claude' },
            { title: 'Reviewer', prompt: 'review the Lexer', provider: 'claude' }
        ];
        const dry = await post('team', [...args(pair), '--dry-run']);
        expect(dry.lines.slice(1)).toEqual([
            'dry-run\tchat\tLexer\tmain\tclaude\tterm-1 -> <Lexer>',
            'dry-run\tchat\tReviewer\tmain\tclaude\tterm-1 -> <Reviewer>'
        ]);
        const { lines } = await post('team', args(pair));
        expect(lines.slice(1).map((line) => line.split('\t')[2])).toEqual(['Lexer', 'Reviewer']);
    });

    test('a label is not unique and a label or a title past the cap is refused', async () => {
        const first = await post('team', args(THREE, 'Crew'));
        const again = await post('team', args(THREE, 'Crew'));
        expect([first.status, again.status]).toEqual([200, 200]);
        expect((await canvasOnDisk()).nodes.filter((node) => node.kind === 'group' && node.title === 'Crew')).toHaveLength(2);

        const long = 'L'.repeat(MAX_TITLE_LENGTH + 1);
        expect((await post('team', args(THREE, long))).lines[0]).toBe(
            `refused\tbad-arguments\t--label is ${MAX_TITLE_LENGTH + 1} characters and at most ${MAX_TITLE_LENGTH} fit in a name on the canvas`
        );
        for (const verb of ['node', 'agent']) {
            const argv = verb === 'node' ? ['new', 'note'] : ['claude'];
            expect((await post(verb, [...argv, '--title', long])).lines[0]).toBe(
                `refused\tbad-arguments\t--title is ${MAX_TITLE_LENGTH + 1} characters and at most ${MAX_TITLE_LENGTH} fit in a name on the canvas`
            );
        }
        expect((await post('link', ['new', '--to', 'note-1', '--label', long])).lines[0]).toStartWith(
            `refused\tbad-arguments\t--label is ${MAX_TITLE_LENGTH + 1} characters`
        );
        // A name of exactly the cap is a name, not a refusal.
        expect((await post('node', ['new', 'note', '--title', 'L'.repeat(MAX_TITLE_LENGTH)])).status).toBe(200);
    });

    test('--reads draws a line from every node it names into every role', async () => {
        const { lines } = await post('team', [...args(THREE.slice(0, 2)), '--reads', 'note-1']);
        const ids = lines.slice(1, 3).map((line) => line.split('\t')[0]!);
        expect(lines.slice(3).map((line) => line.split('\t'))).toEqual([
            ['reads', expect.any(String), 'note-1', ids[0]!],
            ['reads', expect.any(String), 'note-1', ids[1]!]
        ]);
        const canvas = await canvasOnDisk();
        expect(canvas.edges.filter((edge) => edge.from === 'note-1')).toEqual(
            ids.map((id) => ({ id: expect.any(String), from: 'note-1', to: id, label: 'context' }))
        );
    });

    test('--reads is refused for a team the same way it is for one agent', async () => {
        const { status, lines } = await post('team', [...args(THREE), '--reads', 'ghost']);
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
        expect((await onDisk()).rev).toBe(1);
        expect(started).toEqual([]);
    });
});

describe('the depth limit', () => {
    const args = (label: string): string[] => ['--label', label, '--roles', JSON.stringify([{ title: 'Lexer', prompt: 'go', provider: 'claude' }])];

    /* The team a person's own agent opens, and a token for the first of its members. */
    const openTeam = async (label = 'Crew', token = 'term'): Promise<string> => {
        const { lines } = await post('team', args(label), token);
        const member = lines[1]!.split('\t')[0]!;
        TOKENS.member = member;
        return member;
    };

    test('a person opens a team, its members open none, and a restart does not forget that', async () => {
        const member = await openTeam();
        expect(lineage.depthOf(member)).toBe(MAX_TEAM_DEPTH);

        const refused = await post('team', args('Subcrew'), 'member');
        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe(
            `refused\ttoo-deep\tYou sit at depth ${MAX_TEAM_DEPTH} and team would open agents at depth ${MAX_TEAM_DEPTH + 1}; team opens up to depth ${MAX_TEAM_DEPTH}`
        );
        expect(refused.lines.slice(1)).toEqual([
            `depth\tyou\t${MAX_TEAM_DEPTH}`,
            'depth\t0\ta node a person opened',
            `depth\tagent\topens up to depth ${MAX_AGENT_DEPTH}`,
            `depth\tteam\topens up to depth ${MAX_TEAM_DEPTH}`
        ]);

        // The depths are on disk, which is the moment a loop would otherwise start counting over.
        lineage = new AgentLineageStore(join(root, 'home'));
        await lineage.load();
        expect(lineage.depthOf(member)).toBe(MAX_TEAM_DEPTH);
        expect((await post('team', args('Subcrew'), 'member')).lines[0]).toStartWith('refused\ttoo-deep\t');
    });

    test('a member may still open one agent, and that one may open none', async () => {
        await openTeam();
        const opened = (await post('agent', ['claude'], 'member')).lines[0]!.split('\t')[0]!;
        expect(lineage.depthOf(opened)).toBe(MAX_AGENT_DEPTH);

        TOKENS.deep = opened;
        const refused = await post('agent', ['claude'], 'deep');
        expect(refused.lines[0]).toBe(
            `refused\ttoo-deep\tYou sit at depth ${MAX_AGENT_DEPTH} and agent would open agents at depth ${MAX_AGENT_DEPTH + 1}; agent opens up to depth ${MAX_AGENT_DEPTH}`
        );
        expect(lineage.openedCount(opened)).toBe(0);
    });

    test('one caller may not run away with a canvas, however deep it sits', async () => {
        for (let index = 0; index < MAX_OPENED_PER_CALLER; index += 1) {
            await lineage.put({ projectId, nodeId: `stub-${index}`, openedBy: 'term-1', depth: 1, agent: true });
        }
        const refused = await post('agent', ['claude']);
        expect(refused.lines[0]).toBe(
            `refused\ttoo-many-agents\tYou have ${MAX_OPENED_PER_CALLER} agent nodes open and this would open 1 more; one caller may have ${MAX_OPENED_PER_CALLER} open at a time, and the count frees when a person removes them`
        );
        expect((await post('team', args('Crew'))).lines[0]).toStartWith('refused\ttoo-many-agents\t');
        expect((await onDisk()).rev).toBe(1);

        // The nodes a person removed free the count again.
        await lineage.prune(projectId, new Set(['stub-0', 'stub-1']));
        expect((await post('team', args('Crew'))).status).toBe(200);
        expect((await onDisk()).rev).toBe(2);
    });
});

describe('link new', () => {
    test('draws a line from the caller into a node and prints what it made', async () => {
        const { status, lines } = await post('link', ['new', '--to', 'note-1']);
        expect(status).toBe(200);
        const [id, from, to, state, way] = lines[0]!.split('\t');
        expect([from, to, state, way]).toEqual(['term-1', 'note-1', 'new', 'out']);
        expect((await canvasOnDisk()).edges).toEqual([{ id: id!, from: 'term-1', to: 'note-1' }]);
    });

    test('between two agents it draws both ways and labels them context', async () => {
        const pair = content();
        (pair.views[0] as ProjectCanvasView).nodes.push({ id: 'term-2', kind: 'terminal', title: 'other', x: 2000, y: 0, w: 560, h: 360 });
        await store.mutate(projectId, () => ({ content: pair, result: null }));

        const { lines } = await post('link', ['new', '--to', 'term-2']);
        // The last column is what tells one --to answering in two rows from a mistake.
        expect(lines.map((line) => line.split('\t').slice(1))).toEqual([
            ['term-1', 'term-2', 'new', 'out'],
            ['term-2', 'term-1', 'new', 'back']
        ]);
        expect((await canvasOnDisk()).edges.map((edge) => [edge.from, edge.to, edge.label])).toEqual([
            ['term-1', 'term-2', 'context'],
            ['term-2', 'term-1', 'context']
        ]);
    });

    test('running the same link again changes nothing and says so', async () => {
        await post('link', ['new', '--to', 'note-1']);
        const rev = (await onDisk()).rev;
        const { lines } = await post('link', ['new', '--to', 'note-1']);
        expect(lines[0]!.split('\t')[3]).toBe('existing');
        expect((await onDisk()).rev).toBe(rev);
    });

    test('refuses ids that are not on the canvas and a line to itself', async () => {
        const missing = await post('link', ['new', '--to', 'note-1,ghost,other']);
        expect(missing.lines[0]).toBe('refused\tunknown-node\tghost, other are not a node on main');
        // Never the node the line starts from: --to itself is refused as a self-link.
        expect(missing.lines.slice(1)).toEqual(['node\tnote-1\tnote\tPlan with a tab']);
        expect((await post('link', ['new', '--to', 'term-1'])).lines[0]).toStartWith('refused\tself-link\t');
        expect((await post('link', ['new', '--to', 'note-1', '--view', 'main'], 'chat')).lines[0]).toStartWith(
            'refused\tunknown-node\tYou are not a node on main, so a line has nowhere to start'
        );
        expect((await onDisk()).rev).toBe(1);
    });

    test('a chat that is a view of its own is named as one, so nothing goes looking for it on another canvas', async () => {
        const own = await post('link', ['new', '--to', 'chat-1']);
        expect(own.status).toBe(422);
        expect(own.lines[0]).toBe(
            'refused\tnot-on-a-canvas\tchat-1 is a chat that is a view of its own, not a node on any canvas of this project, so no line can be drawn into it'
        );
        // The same misunderstanding at the other end of the line.
        expect((await post('link', ['new', '--to', 'note-1', '--from', 'chat-1'])).lines[0]).toBe(
            'refused\tnot-on-a-canvas\tchat-1 is a chat that is a view of its own, not a node on any canvas of this project, so a line has nowhere to start there'
        );
        // Beside an id that names nothing, the sentence about the set stays and the view is named under it.
        const both = await post('link', ['new', '--to', 'chat-1,ghost']);
        expect(both.lines[0]).toBe('refused\tunknown-node\tchat-1, ghost are not a node on main');
        expect(both.lines[1]).toBe('note\tchat-1 is a chat that is a view of its own, not a node on any canvas of this project');
        // A node on another canvas of this project is neither case and keeps the sentence it had.
        const elsewhere = (await post('node', ['new', 'note', '--view', 'board'])).lines[0]!.split('\t')[0]!;
        expect((await post('link', ['new', '--to', elsewhere])).lines[0]).toBe(`refused\tunknown-node\t${elsewhere} is not a node on main`);
    });

    test('--from, --label and --view say where the line goes and what it is called', async () => {
        const { lines } = await post('link', ['new', '--to', 'term-1', '--from', 'note-1', '--label', 'plan']);
        expect(lines[0]!.split('\t').slice(1)).toEqual(['note-1', 'term-1', 'new', 'out']);
        expect((await canvasOnDisk()).edges[0]!.label).toBe('plan');
    });

    test('refuses more than the cap and an empty id', async () => {
        const many = Array.from({ length: MAX_LINKS + 1 }, (_, i) => `n-${i}`).join(',');
        expect((await post('link', ['new', '--to', many])).lines[0]).toStartWith('refused\ttoo-many-links\t');
        expect((await post('link', ['new', '--to', 'note-1,'])).lines[0]).toStartWith('refused\tbad-arguments\t');
    });

    test('--role says what the line is for and puts the word on the edge', async () => {
        await post('link', ['new', '--to', 'note-1', '--role', 'target']);
        expect((await canvasOnDisk()).edges.map((edge) => [edge.from, edge.to, edge.role])).toEqual([['term-1', 'note-1', 'target']]);
    });

    test('a target or an origin is one line, and is never named context by itself', async () => {
        const pair = content();
        (pair.views[0] as ProjectCanvasView).nodes.push({ id: 'term-2', kind: 'terminal', title: 'other', x: 2000, y: 0, w: 560, h: 360 });
        await store.mutate(projectId, () => ({ content: pair, result: null }));

        const { lines } = await post('link', ['new', '--to', 'term-2', '--role', 'origin']);
        expect(lines.map((line) => line.split('\t').slice(1))).toEqual([['term-1', 'term-2', 'new', 'out']]);
        expect((await canvasOnDisk()).edges.map((edge) => [edge.label, edge.role])).toEqual([[undefined, 'origin']]);
    });

    test('refuses a role it does not have and says which ones it does', async () => {
        const { status, lines } = await post('link', ['new', '--to', 'note-1', '--role', 'beams']);
        expect(status).toBe(422);
        expect(lines[0]).toBe(`refused\tunknown-role\tbeams is not one of the ${EDGE_ROLES.length} things a line can be for`);
        expect(lines[1]).toBe(['roles', ...EDGE_ROLES].join('\t'));
        expect((await onDisk()).rev).toBe(1);
    });

    test('a --role that is not the one on the line is written onto it and says updated', async () => {
        const drawn = await post('link', ['new', '--to', 'note-1']);
        const edgeId = drawn.lines[0]!.split('\t')[0]!;
        expect(drawn.lines[0]!.split('\t')[3]).toBe('new');

        const set = await post('link', ['new', '--to', 'note-1', '--role', 'target']);
        expect(set.lines[0]!.split('\t')).toEqual([edgeId, 'term-1', 'note-1', 'updated', 'out']);
        expect((await canvasOnDisk()).edges).toEqual([{ id: edgeId, from: 'term-1', to: 'note-1', role: 'target' }]);
    });

    test('the same role again, or none at all, leaves the line alone and says existing', async () => {
        await post('link', ['new', '--to', 'note-1', '--role', 'target']);
        const rev = (await onDisk()).rev;

        expect((await post('link', ['new', '--to', 'note-1', '--role', 'target'])).lines[0]!.split('\t')[3]).toBe('existing');
        // Nothing changed, so nothing was written and the rev a second call reads is the one it leaves.
        expect((await onDisk()).rev).toBe(rev);
        expect((await post('link', ['new', '--to', 'note-1'])).lines[0]!.split('\t')[3]).toBe('existing');
        expect((await canvasOnDisk()).edges[0]!.role).toBe('target');
        expect((await onDisk()).rev).toBe(rev);
    });
});

describe('--dry-run', () => {
    test('agent checks everything, prints what it would make and writes nothing', async () => {
        const { status, lines } = await post('agent', ['claude', '--prompt', 'hi', '--dry-run']);
        expect(status).toBe(200);
        expect(lines).toEqual([`dry-run\tchat\tmain\tclaude\tterm-1 -> ${NEW_NODE}`]);
        expect((await onDisk()).rev).toBe(1);
        expect(held).toEqual([]);
    });

    test('agent names the lines --reads would draw and draws none of them', async () => {
        const { lines } = await post('agent', ['claude', '--reads', 'note-1', '--dry-run']);
        expect(lines).toEqual([`dry-run\tchat\tmain\tclaude\tterm-1 -> ${NEW_NODE}`, `dry-run\treads\tnote-1 -> ${NEW_NODE}`]);
        expect((await onDisk()).rev).toBe(1);
        // A dry run refuses what a real one would, so an id that names nothing never prints a plan.
        expect((await post('agent', ['claude', '--reads', 'ghost', '--dry-run'])).lines[0]).toStartWith('refused\tunknown-node\t');
    });

    test('a dry run still refuses what a real one would', async () => {
        installed = ['codex'];
        expect((await post('agent', ['claude', '--dry-run'])).lines[0]).toStartWith('refused\tcli-not-installed\t');
        installed = ['claude'];
        expect((await post('agent', ['claude', '--group', 'note-1', '--dry-run'])).lines[0]).toStartWith('refused\tunknown-group\t');
    });

    test('node says which kind it would have made', async () => {
        expect((await post('node', ['new', 'note', '--text', 'x', '--dry-run'])).lines).toEqual([`dry-run\tnote\tmain\tterm-1 -> ${NEW_NODE}`]);
        // A caller that is a node on no canvas names one, and the edge column says no line would be drawn.
        expect((await post('node', ['new', 'note', '--view', 'board', '--dry-run'], 'chat')).lines).toEqual(['dry-run\tnote\tboard\t-']);
        expect((await onDisk()).rev).toBe(1);
    });

    test('a verb that makes nothing refuses the flag and names the ones that take it', async () => {
        const { status, lines } = await post('node', ['list', '--dry-run']);
        expect(status).toBe(422);
        expect(lines).toEqual([
            'refused\tno-dry-run\tnode list takes no --dry-run; only the verbs that make something do',
            'verb\tnode new\ttakes --dry-run',
            'verb\tagent\ttakes --dry-run',
            'verb\tplan new\ttakes --dry-run',
            'verb\tteam\ttakes --dry-run'
        ]);
        expect((await post('link', ['new', '--to', 'note-1', '--dry-run'])).lines[0]).toStartWith('refused\tno-dry-run\t');
    });

    test('a verb that takes the flag refuses an unknown one beside it as unknown, not as a dry run it would do', async () => {
        for (const [verb, args] of [
            ['node', ['new', 'note', '--bogus', 'y', '--dry-run']],
            ['node', ['new', 'note', '--dry-run', '--bogus', 'y']],
            ['agent', ['claude', '--bogus', 'y', '--dry-run']]
        ] as const) {
            const { status, lines } = await post(verb, [...args]);
            expect(status).toBe(422);
            expect(lines[0]).toStartWith('refused\tunknown-flag\t--bogus is not one of ');
        }
        expect((await onDisk()).rev).toBe(1);
    });
});

describe('view new', () => {
    test('a view and a node of a kind this daemon does not know stay in the file, exactly as they were', async () => {
        const hologram = { kind: 'hologram', id: 'holo', title: 'Hologram', x: 900, y: 0, w: 480, h: 360, beam: { lumens: [1, 2] } };
        const timeline = { name: 'Flow', kind: 'timeline', id: 'timeline-1', tracks: [{ at: 0 }] };
        const file = await onDisk();
        const main = file.views[0] as ProjectCanvasView;
        const views = [{ ...main, nodes: [...main.nodes, hologram] }, timeline, ...file.views.slice(1)];
        await setPrivateViews(folder, views);

        expect((await post('view', ['new', 'Plan'])).status).toBe(200);

        const raw = (await rawPrivateViews(folder)) as unknown as Array<{ id: string; nodes?: Array<{ id: string }> }>;
        expect(JSON.stringify(raw.find((view) => view.id === 'timeline-1'))).toBe(JSON.stringify(timeline));
        expect(JSON.stringify(raw[0]!.nodes!.find((node) => node.id === 'holo'))).toBe(JSON.stringify(hologram));
        expect((await onDisk()).views.at(-1)).toMatchObject({ kind: 'canvas', name: 'Plan' });
    });

    test('adds a canvas last in the sidebar and writes the caller down as its maker', async () => {
        const { status, lines } = await post('view', ['new', 'Plan']);
        expect(status).toBe(200);
        const [id, kind, name] = lines[0]!.split('\t');
        expect([kind, name]).toEqual(['canvas', 'Plan']);
        expect((await onDisk()).views.at(-1)).toMatchObject({ id, kind: 'canvas', name: 'Plan', createdBy: 'term-1', nodes: [], edges: [] });
    });

    test('every kind of the union in contracts is one it makes', async () => {
        const extra: Partial<Record<(typeof VIEW_KINDS)[number], string[]>> = {
            file: ['--path', 'src/main.ts'],
            browser: ['--url', 'https://bas.dev']
        };
        for (const kind of VIEW_KINDS) {
            const { status, lines } = await post('view', ['new', `A ${kind}`, '--kind', kind, ...(extra[kind] ?? [])]);
            expect(status).toBe(200);
            const [id, said] = lines[0]!.split('\t');
            expect(said).toBe(kind);
            expect(await viewOnDisk(id!)).toMatchObject({ kind, name: `A ${kind}`, createdBy: 'term-1' });
        }
    });

    test('a file view stores its path folder-relative and a browser view keeps its address', async () => {
        const file = await made('main.ts', ['--kind', 'file', '--path', join(folder, 'src', 'main.ts')]);
        expect(await viewOnDisk(file)).toMatchObject({ kind: 'file', path: 'src/main.ts' });
        const outsideFile = await made('notes.md', ['--kind', 'file', '--path', join(outside, 'notes.md')]);
        expect(await viewOnDisk(outsideFile)).toMatchObject({ path: join(outside, 'notes.md') });
        const page = await made('Docs', ['--kind', 'browser', '--url', 'https://bas.dev/docs']);
        expect(await viewOnDisk(page)).toMatchObject({ kind: 'browser', url: 'https://bas.dev/docs' });
    });

    test('--after puts the row right under the view it names', async () => {
        const id = await made('Plan', ['--after', 'main']);
        expect((await onDisk()).views.map((view) => view.id)).toEqual(['main', id, 'sep-1', 'board', 'chat-1', 'sketch-1']);
    });

    test('--after that names no view of this project is refused with the views', async () => {
        const { status, lines } = await post('view', ['new', 'Plan', '--after', 'nowhere']);
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tunknown-view\tnowhere is not a view of this project');
        expect(lines.slice(1, -1)).toEqual([
            'view\tmain\tcanvas\tCanvas',
            'view\tsep-1\tseparator\t',
            'view\tboard\tcanvas\tBoard',
            'view\tchat-1\tchat\tPlanner',
            'view\tsketch-1\tdrawing\tSketch'
        ]);
        expect((await onDisk()).rev).toBe(1);
    });

    test('a kind that needs a flag refuses without it, and a flag that is not for the kind is refused too', async () => {
        expect((await post('view', ['new', 'Doc', '--kind', 'file'])).lines[0]).toBe('refused\tmissing-flag\tA file view needs --path');
        expect((await post('view', ['new', 'Page', '--kind', 'browser'])).lines[0]).toBe('refused\tmissing-flag\tA browser view needs --url');
        expect((await post('view', ['new', 'Plan', '--url', 'https://bas.dev'])).lines[0]).toBe(
            'refused\tflag-not-for-kind\t--url does not go with a canvas view'
        );
        expect((await post('view', ['new', 'Page', '--kind', 'browser', '--url', 'ftp://bas.dev'])).lines[0]).toStartWith('refused\tbad-url\t');
        expect((await post('view', ['new', 'Doc', '--kind', 'file', '--path', 'nowhere.ts'])).lines[0]).toStartWith('refused\tbad-path\t');
    });

    test('a kind that is not in the union is refused with the ones that are', async () => {
        const { lines } = await post('view', ['new', 'Plan', '--kind', 'kanban']);
        expect(lines[0]).toBe(`refused\tbad-arguments\t--kind takes one of ${VIEW_KINDS.join(', ')}`);
    });

    test('a name is needed, and only one', async () => {
        expect((await post('view', ['new'])).lines[0]).toBe('refused\tbad-arguments\tview new needs a name');
        expect((await post('view', ['new', 'a', 'b'])).lines[0]).toBe(
            'refused\tbad-arguments\tview new takes one name and nothing else; a name with spaces in it is one argument'
        );
    });

    test('a project holds only so many rows', async () => {
        const start = (await onDisk()).views.length;
        for (let index = start; index < MAX_PROJECT_VIEWS; index += 1) {
            await post('view', ['new', `View ${index}`]);
        }
        const { status, lines } = await post('view', ['new', 'One too many']);
        expect(status).toBe(422);
        expect(lines[0]).toBe(`refused\ttoo-many-views\tThis project has ${MAX_PROJECT_VIEWS} views and a project holds at most ${MAX_PROJECT_VIEWS}`);
    });
});

describe('view rename', () => {
    test('renames a view and says nothing it hosts may rename it again', async () => {
        const { status, lines } = await post('view', ['rename', 'board', 'Roadmap']);
        expect(status).toBe(200);
        expect(lines).toEqual(['board\tcanvas\tRoadmap']);
        expect(await viewOnDisk('board')).toMatchObject({ name: 'Roadmap', titleSource: 'user' });
    });

    test('a rename to the name it already carries writes nothing at all', async () => {
        await post('view', ['rename', 'board', 'Roadmap']);
        const rev = (await onDisk()).rev;
        expect((await post('view', ['rename', 'board', 'Roadmap'])).lines).toEqual(['board\tcanvas\tRoadmap']);
        expect((await onDisk()).rev).toBe(rev);
    });

    test('an id that is no view of this project is refused with the views', async () => {
        const { status, lines } = await post('view', ['rename', 'Board', 'Roadmap']);
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tunknown-view\tBoard is not a view of this project');
        expect(lines.at(-1)).toBe('note\tview rename takes a view id, never a name');
    });
});

describe('view icon', () => {
    test('takes a Lucide name from the closed set', async () => {
        expect((await post('view', ['icon', 'board', 'rocket'])).lines).toEqual(['board\tcanvas\tlucide\trocket']);
        expect(await viewOnDisk('board')).toMatchObject({ icon: { kind: 'lucide', value: 'rocket' } });
    });

    test('view list shows the mark in its last column, after every column it had before', async () => {
        await post('view', ['icon', 'board', 'rocket']);
        const board = (await post('view', ['list'])).lines.find((line) => line.startsWith('board\t'));
        expect(board).toBe('board\tcanvas\tBoard\tno\ta person made it\trocket');
        await post('view', ['icon', 'board', 'null']);
        expect((await post('view', ['list'])).lines.find((line) => line.startsWith('board\t'))).toBe('board\tcanvas\tBoard\tno\ta person made it\t-');
    });

    test('null takes a mark away again', async () => {
        await post('view', ['icon', 'board', 'rocket']);
        expect((await post('view', ['icon', 'board', 'null'])).lines).toEqual(['board\tcanvas\tnull']);
        expect(await viewOnDisk('board')).not.toHaveProperty('icon');
        expect((await post('view', ['icon', 'board', 'null'])).lines).toEqual(['board\tcanvas\tnull']);
    });

    test('a mark a person typed is refused with the set, and so is a typo', async () => {
        expect((await post('view', ['icon', 'board', '\u{1f680}'])).lines[0]).toBe(
            `refused\tunknown-icon\t\u{1f680} is not one of the ${PROJECT_ICON_NAMES.length} Lucide names a view picks from`
        );
        const { status, lines } = await post('view', ['icon', 'board', 'rockett']);
        expect(status).toBe(422);
        expect(lines[0]).toBe(`refused\tunknown-icon\trockett is not one of the ${PROJECT_ICON_NAMES.length} Lucide names a view picks from`);
        expect(lines.slice(1).every((line) => line.startsWith('icons\t'))).toBe(true);
        expect(lines.slice(1).flatMap((line) => line.split('\t').slice(1))).toEqual([...PROJECT_ICON_NAMES]);
    });

    test('a divider has no room for a mark', async () => {
        expect((await post('view', ['icon', 'sep-1', 'rocket'])).lines[0]).toBe(
            'refused\tnot-markable\tsep-1 is a separator, a row that divides the sidebar and has no room for a mark'
        );
        const [made] = (await post('view', ['new', 'Agents', '--kind', 'subheader'])).lines;
        const id = made!.split('\t')[0]!;
        expect((await post('view', ['icon', id, 'rocket'])).lines[0]).toBe(
            `refused\tnot-markable\t${id} is a subheader, a row that divides the sidebar and has no room for a mark`
        );
    });
});

describe('view move', () => {
    test('--first puts the row at the top and --after right under the view it names', async () => {
        expect((await post('view', ['move', 'board', '--first'])).lines).toEqual(['board\tcanvas\t0']);
        expect((await onDisk()).views.map((view) => view.id)).toEqual(['board', 'main', 'sep-1', 'chat-1', 'sketch-1']);
        expect((await post('view', ['move', 'board', '--after', 'chat-1'])).lines).toEqual(['board\tcanvas\t3']);
        expect((await onDisk()).views.map((view) => view.id)).toEqual(['main', 'sep-1', 'chat-1', 'board', 'sketch-1']);
    });

    test('exactly one of --after and --first, and never under itself', async () => {
        const both = await post('view', ['move', 'board', '--first', '--after', 'main']);
        expect(both.lines[0]).toBe('refused\ttwo-places\tview move takes exactly one of --after and --first');
        expect((await post('view', ['move', 'board'])).lines[0]).toBe('refused\ttwo-places\tview move takes exactly one of --after and --first');
        expect((await post('view', ['move', 'board', '--after', 'board'])).lines[0]).toBe('refused\ttwo-places\tview move cannot put a view under itself');
        expect((await onDisk()).rev).toBe(1);
    });

    test('moving a row to where it already stands writes nothing', async () => {
        expect((await post('view', ['move', 'main', '--first'])).lines).toEqual(['main\tcanvas\t0']);
        expect((await onDisk()).rev).toBe(1);
    });
});

describe('view delete', () => {
    test('removes a view the caller made and names it', async () => {
        const id = await made('Plan');
        const { status, lines } = await post('view', ['delete', id]);
        expect(status).toBe(200);
        expect(lines).toEqual([`deleted\t${id}\tcanvas\tPlan`]);
        expect(await viewOnDisk(id)).toBeUndefined();
    });

    test('refuses a view the caller did not make, naming who did and how the machine frees it', async () => {
        const { status, lines } = await post('view', ['delete', 'board']);
        expect(status).toBe(422);
        expect(lines).toEqual([
            'refused\tnot-yours\tboard was made by a person and view delete only removes a view you made yourself',
            'made by\ta person',
            'you\tterm-1',
            "setting\tagentsDeleteAnyView in this machine's endpoint.json frees every view; a person turns it on from the Machines pane"
        ]);
        expect(await viewOnDisk('board')).toBeDefined();
    });

    test('a view another agent made is not the caller’s either', async () => {
        const id = await made('Theirs', [], 'chat');
        const { lines } = await post('view', ['delete', id]);
        expect(lines[0]).toBe(`refused\tnot-yours\t${id} was made by chat-1 and view delete only removes a view you made yourself`);
        expect(lines[1]).toBe('made by\tchat-1');
    });

    test('the same delete goes through once the machine frees every view', async () => {
        expect((await post('view', ['delete', 'board'])).status).toBe(422);
        deleteAnyView = true;
        expect((await post('view', ['delete', 'board'])).lines).toEqual(['deleted\tboard\tcanvas\tBoard']);
        expect(await viewOnDisk('board')).toBeUndefined();
    });

    test('never the view the caller is standing in, however free the machine is', async () => {
        deleteAnyView = true;
        expect((await post('view', ['delete', 'main'])).lines[0]).toBe('refused\tdeletes-caller\tYou are in main, so removing it would end the session asking');
        expect((await post('view', ['delete', 'chat-1'], 'chat')).lines[0]).toBe(
            'refused\tdeletes-caller\tYou are in chat-1, so removing it would end the session asking'
        );
    });

    test('a canvas takes its sessions with it, and the answer names them', async () => {
        const id = await made('Crew');
        const shell = (await post('node', ['new', 'terminal', '--view', id])).lines[0]!.split('\t')[0]!;
        const chat = (await post('node', ['new', 'chat', '--view', id])).lines[0]!.split('\t')[0]!;
        await post('node', ['new', 'note', '--text', 'x', '--view', id]);

        const { lines } = await post('view', ['delete', id]);
        expect(lines.slice(0, 3)).toEqual([`deleted\t${id}\tcanvas\tCrew`, `ended\t${shell}\tterminal`, `ended\t${chat}\tchat`]);
        // What went with it, named the way the sessions are: a bare deleted line leaves the note a mystery.
        expect(lines[3]).toBe('nodes\t3');
        expect(lines.filter((line) => line.startsWith('node\t')).map((line) => line.split('\t')[1])).toEqual([shell, chat, expect.any(String)]);
        // The daemon ends them itself, which is what makes the verb work with no client connected.
        expect(ended).toEqual([`terminal\t${shell}`, `chat\t${chat}`]);
    });

    test('a chat view of its own is the one session it is', async () => {
        const id = await made('Helper', ['--kind', 'chat']);
        expect((await post('view', ['delete', id])).lines).toEqual([`deleted\t${id}\tchat\tHelper`, `ended\t${id}\tchat`]);
    });

    test('what the daemon held for a node goes with the canvas the node stood on', async () => {
        const id = await made('Crew');
        const opened = (await post('agent', ['claude', '--view', id, '--prompt', 'go'])).lines[0]!.split('\t')[0]!;
        expect(lineage.openedCount('term-1')).toBe(1);
        // The same hook the daemon wires up, which is what prunes a prompt and a lineage record.
        let pruned: Promise<void> = Promise.resolve();
        store.index.onPlaces = (project, ids) => {
            pruned = lineage.prune(project, ids);
        };

        await post('view', ['delete', id]);
        await pruned;
        expect(lineage.depthOf(opened)).toBe(0);
        expect(lineage.openedCount('term-1')).toBe(0);
    });

    test('the sidebar can never be emptied, because the caller is always standing in one of the rows', async () => {
        deleteAnyView = true;
        for (const id of ['main', 'sep-1', 'chat-1', 'board', 'sketch-1']) {
            await post('view', ['delete', id], 'chat');
        }
        // Every other row went; the caller's own view is the one that refused.
        expect((await onDisk()).views).toMatchObject([{ id: 'chat-1', kind: 'chat' }]);
    });

    test('an id that is no view of this project is refused with the views', async () => {
        expect((await post('view', ['delete', 'nowhere'])).lines[0]).toBe('refused\tunknown-view\tnowhere is not a view of this project');
    });
});

describe('the view verb itself', () => {
    test('needs one of its words, and says which they are', async () => {
        const { status, lines } = await post('view', []);
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tunknown-action\tview needs one of list, new, rename, icon, move, delete, open, diagram');
        expect(lines.slice(1)).toEqual([...VIEW_SUBS.map((sub) => `usage\t${sub.name}\t${sub.usage}`), 'detail\truimte-context help view']);
        expect((await post('view', ['duplicate', 'board'])).lines[0]).toBe(
            'refused\tunknown-action\tview needs one of list, new, rename, icon, move, delete, open, diagram, and duplicate is not one'
        );
    });

    test('help view prints the signature of every one of them, out of the registry', async () => {
        const { lines } = await post('help', ['view']);
        for (const sub of VIEW_SUBS) {
            expect(lines).toContain(`action\t${sub.name}\t${sub.usage}\t${sub.summary}`);
        }
    });

    test('a session that is in no project of this machine changes nothing', async () => {
        expect((await post('view', ['new', 'Plan'], 'stray')).lines[0]).toStartWith('refused\tnot-in-project\t');
        expect((await post('view', ['delete', 'board'], 'stray')).lines[0]).toStartWith('refused\tnot-in-project\t');
    });
});

describe('view open', () => {
    /* What open itself would take: the separator is left out, since open refuses it a line later. */
    const VIEW_LINES = ['view\tmain\tcanvas\tCanvas', 'view\tboard\tcanvas\tBoard', 'view\tchat-1\tchat\tPlanner', 'view\tsketch-1\tdrawing\tSketch'];

    test('tells the clients that have the project on screen, and writes nothing', async () => {
        await store.openProject({ projectId });
        store.hold('client-1', projectId);
        const { status, lines } = await post('view', ['open', 'board']);
        expect(status).toBe(200);
        expect(lines).toEqual(['showing\tboard\tcanvas\tBoard', 'sent\tyes\tEveryone with this project on screen was told']);
        expect(watching).toEqual([{ projectId, viewId: 'board', by: 'term-1' }]);
        // Showing is personal, so the shared file stands where the last write left it.
        expect((await onDisk()).rev).toBe(1);
    });

    test('a project nobody has on screen is not a failure, and the client is not told', async () => {
        const { status, lines } = await post('view', ['open', 'sketch-1']);
        expect(status).toBe(200);
        expect(lines).toEqual(['showing\tsketch-1\tdrawing\tSketch', 'sent\tno\tNobody has this project on screen right now, so nothing was showing it']);
        expect(watching).toEqual([]);
    });

    test('a client that let the project go stops being told', async () => {
        store.hold('client-1', projectId);
        expect((await post('view', ['open', 'board'])).lines[1]).toStartWith('sent\tyes\t');
        store.letGo('client-1', projectId);
        expect((await post('view', ['open', 'board'])).lines[1]).toStartWith('sent\tno\t');
        expect(watching).toHaveLength(1);
    });

    test('a divider never opens', async () => {
        const { status, lines } = await post('view', ['open', 'sep-1']);
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tnever-opens\tsep-1 is a separator and has nothing to show');
        expect(lines.slice(1)).toEqual(VIEW_LINES);
        expect(watching).toEqual([]);

        const [made] = (await post('view', ['new', 'Agents', '--kind', 'subheader'])).lines;
        const id = made!.split('\t')[0]!;
        const heading = await post('view', ['open', id]);
        expect(heading.status).toBe(422);
        expect(heading.lines[0]).toBe(`refused\tnever-opens\t${id} is a subheader and has nothing to show`);
        expect(watching).toEqual([]);
    });

    test('an id the project does not have is refused with the views it does', async () => {
        const { status, lines } = await post('view', ['open', 'Board']);
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tunknown-view\tBoard is not a view of this project');
        expect(lines.slice(1)).toEqual([...VIEW_LINES, 'note\tview open takes a view id, never a name']);
        expect(watching).toEqual([]);
    });

    test('takes one id, and nothing that would make it a dry run', async () => {
        expect((await post('view', ['open'])).lines[0]).toBe('refused\tbad-arguments\tview open needs the id of a view');
        expect((await post('view', ['open', 'board', 'main'])).lines[0]).toBe('refused\tbad-arguments\tview open takes one view id and nothing else');
        expect((await post('view', ['open', 'board', '--dry-run'])).lines[0]).toStartWith('refused\tno-dry-run\t');
        expect(watching).toEqual([]);
    });

    test('a session that is in no project of this machine shows nobody anything', async () => {
        expect((await post('view', ['open', 'board'], 'stray')).lines[0]).toStartWith('refused\tnot-in-project\t');
        expect(watching).toEqual([]);
    });
});

/* Nodes put on the main canvas beside the two the fixture has, for the verbs that move what is there. */
const seed = async (...nodes: ProjectNode[]): Promise<void> => {
    const next = content();
    (next.views[0] as ProjectCanvasView).nodes.push(...nodes);
    await store.mutate(projectId, () => ({ content: next, result: null }));
};

const box = (id: string, x: number, y: number, extra: Partial<ProjectNode> = {}): ProjectNode => ({
    id,
    kind: 'note',
    title: id,
    x,
    y,
    w: 200,
    h: 100,
    ...extra
});

const nodeOnDisk = async (id: string): Promise<ProjectNode | undefined> => (await canvasOnDisk()).nodes.find((node) => node.id === id);

describe('node group', () => {
    test('draws the frame a person grouping the same selection would have drawn', async () => {
        await seed(box('a', 400, 400), box('b', 800, 600));
        const { status, lines } = await post('node', ['group', '--nodes', 'a,b']);
        expect(status).toBe(200);
        const [id, kind, title, view, members] = lines[0]!.split('\t');
        expect([kind, title, view, members]).toEqual(['group', 'Group', 'main', '2']);
        // The client's own arithmetic (`groupSelection` in apps/client/src/state/canvas.ts), written out.
        const snap = (value: number): number => Math.round(value / CANVAS_GRID) * CANVAS_GRID;
        expect(await nodeOnDisk(id!)).toEqual({
            id: id!,
            kind: 'group',
            title: 'Group',
            x: snap(400 - GROUP_PADDING),
            y: snap(400 - GROUP_PADDING - GROUP_HEADER),
            w: snap(600 + GROUP_PADDING * 2),
            h: snap(300 + GROUP_PADDING * 2 + GROUP_HEADER)
        });
    });

    test('--label and --color are the ones the client offers', async () => {
        await seed(box('a', 400, 400), box('b', 800, 600));
        const { lines } = await post('node', ['group', '--nodes', 'a,b', '--label', 'Parser work', '--color', 'violet']);
        expect(lines[0]!.split('\t')[2]).toBe('Parser work');
        expect(await nodeOnDisk(lines[0]!.split('\t')[0]!)).toMatchObject({ title: 'Parser work', accent: 'violet' });

        const bad = await post('node', ['group', '--nodes', 'a', '--color', '#ff0000']);
        expect(bad.status).toBe(422);
        expect(bad.lines[0]).toBe(`refused\tunknown-color\t#ff0000 is not one of the ${NODE_ACCENT_NAMES.length} colors a frame takes`);
        expect(bad.lines[1]).toBe(['colors', ...NODE_ACCENT_NAMES].join('\t'));
    });

    test('says which nodes it caught that were not named', async () => {
        await seed(box('a', 400, 400), box('b', 800, 600), box('between', 600, 500));
        const { lines } = await post('node', ['group', '--nodes', 'a,b']);
        expect(lines[0]!.split('\t')[4]).toBe('3');
        expect(lines.slice(1)).toEqual(['also\tbetween\tnote\tbetween']);
    });

    test('refuses a group, since the client leaves one out of a selection too', async () => {
        await seed(box('a', 400, 400), box('frame', 300, 300, { kind: 'group', w: 800, h: 800 }));
        const { status, lines } = await post('node', ['group', '--nodes', 'a,frame']);
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tnot-groupable\tframe is a group');
        expect((await canvasOnDisk()).nodes.filter((node) => node.kind === 'group')).toHaveLength(1);
    });

    test('a refusal over an id never offers the frame this verb refuses a line later', async () => {
        await seed(box('a', 400, 400), box('frame', 300, 300, { kind: 'group', w: 800, h: 800 }));
        for (const verb of ['group', 'arrange']) {
            const { lines } = await post('node', [verb, '--nodes', 'a,ghost']);
            expect(lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
            expect(lines.slice(1)).not.toContain('node\tframe\tgroup\tframe');
            expect(lines.slice(1)).toContain('node\ta\tnote\ta');
        }
    });

    test('refuses nodes that do not stand in the same place already', async () => {
        await seed(box('inside', 400, 400), box('outside', 4000, 4000), box('frame', 300, 300, { kind: 'group', w: 800, h: 800 }));
        const { status, lines } = await post('node', ['group', '--nodes', 'inside,outside']);
        expect(status).toBe(422);
        expect(lines[0]).toBe(
            'refused\tdifferent-groups\tinside stands in group frame and outside stands on the canvas itself; a frame goes around nodes that are already in the same place'
        );
    });

    test('inside a folded group the new frame joins its members in the file', async () => {
        await seed(
            box('one', 400, 400),
            box('two', 700, 400),
            box('frame', 300, 300, { kind: 'group', w: 800, h: 39, collapsed: true, expandedHeight: 800, memberIds: ['one', 'two'] })
        );
        const { lines } = await post('node', ['group', '--nodes', 'one,two']);
        const id = lines[0]!.split('\t')[0]!;
        expect((await nodeOnDisk('frame'))!.memberIds).toEqual(['one', 'two', id]);
    });

    test('refuses an id that is not on the canvas, and says nothing about titles', async () => {
        await seed(box('a', 400, 400));
        const missing = await post('node', ['group', '--nodes', 'a,ghost']);
        expect(missing.lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
        expect(missing.lines.slice(1)).toContain('node\ta\tnote\ta');
        expect((await post('node', ['group', '--nodes', 'a,'])).lines[0]).toStartWith('refused\tbad-arguments\t');
        expect((await post('node', ['group'])).lines[0]).toBe('refused\tbad-arguments\t--nodes needs one or more node ids, separated by commas');
        expect((await post('node', ['group', '--nodes', 'a', '--dry-run'])).lines[0]).toStartWith('refused\tno-dry-run\t');
    });

    test('works on another canvas than the caller is on, and only through --view', async () => {
        await store.mutate(projectId, (current) => {
            const next = structuredClone(current);
            (next.views[2] as ProjectCanvasView).nodes.push(box('far', 0, 0));
            return { content: next, result: null };
        });
        expect((await post('node', ['group', '--nodes', 'far'])).lines[0]).toBe('refused\tunknown-node\tfar is not a node on main');
        const { lines } = await post('node', ['group', '--nodes', 'far', '--view', 'board']);
        expect(lines[0]!.split('\t')[3]).toBe('board');
    });

    /* A note the caller opened, which is what node new draws a line from the caller into. */
    const newNote = async (token = 'term', argv: string[] = []): Promise<string> =>
        (await post('node', ['new', 'note', ...argv], token)).lines[0]!.split('\t')[0]!;

    const edgesOnDisk = async (): Promise<ProjectEdge[]> => (await canvasOnDisk()).edges;

    test('the lines it had into the nodes become one line into the group', async () => {
        const notes = [await newNote(), await newNote(), await newNote()];
        expect(await edgesOnDisk()).toHaveLength(3);

        const { lines } = await post('node', ['group', '--nodes', notes.join(','), '--label', 'Roles']);
        const edges = await edgesOnDisk();
        expect(edges).toHaveLength(1);
        // The line node new draws into a note, drawn into the group that stands for all three.
        expect(edges[0]).toMatchObject({ from: 'term-1', to: lines[0]!.split('\t')[0]!, role: 'origin' });
        expect(lines.at(-1)).toBe(`edges\t3\t${edges[0]!.id}`);
    });

    test('a line a person drew stays, because that is the context they gave', async () => {
        await seed(box('theirs', 2000, 2000));
        const mine = await newNote('term', ['--beside', 'theirs']);
        const drawn = (await post('link', ['new', '--to', 'theirs'])).lines[0]!.split('\t')[0]!;

        const { lines } = await post('node', ['group', '--nodes', `${mine},theirs`]);
        const edges = await edgesOnDisk();
        expect(edges).toHaveLength(2);
        expect(edges[0]!.id).toBe(drawn);
        expect(edges[1]).toMatchObject({ from: 'term-1', to: lines[0]!.split('\t')[0]! });
        expect(lines.at(-1)).toBe(`edges\t1\t${edges[1]!.id}`);
    });

    test('nodes it had no line into get no line into their frame either', async () => {
        await seed(box('a', 400, 400), box('b', 800, 600));
        const { lines } = await post('node', ['group', '--nodes', 'a,b']);
        expect(await edgesOnDisk()).toEqual([]);
        expect(lines.some((line) => line.startsWith('edges\t'))).toBe(false);
    });

    test('the line another agent drew into the same node stays where it is', async () => {
        const shared = await newNote();
        // A chat that is a view of its own gets no line into what it adds, so it draws one itself.
        const theirs = await newNote('chat', ['--view', 'main']);
        const drawn = (await post('link', ['new', '--from', theirs, '--to', shared, '--view', 'main'], 'chat')).lines[0]!.split('\t')[0]!;

        const { lines } = await post('node', ['group', '--nodes', shared]);
        const edges = await edgesOnDisk();
        expect(edges).toHaveLength(2);
        expect(edges[0]!.id).toBe(drawn);
        expect(edges[1]).toMatchObject({ from: 'term-1', to: lines[0]!.split('\t')[0]! });
        expect(lines.at(-1)).toBe(`edges\t1\t${edges[1]!.id}`);
    });

    test('a frame inside a frame leaves the line into the frame around it alone', async () => {
        await seed(box('far', 4000, 0));
        const one = await newNote();
        const two = await newNote('term', ['--beside', 'far']);
        const outer = (await post('node', ['group', '--nodes', `${one},${two}`])).lines[0]!.split('\t')[0]!;
        const around = (await edgesOnDisk())[0]!.id;

        // A line drawn again into a node that stands in a frame, which the frame inside it replaces.
        const again = (await post('link', ['new', '--to', one])).lines[0]!.split('\t')[0]!;
        const { lines } = await post('node', ['group', '--nodes', one]);
        const inner = lines[0]!.split('\t')[0]!;
        const edges = await edgesOnDisk();
        expect(edges.map((edge) => edge.id)).not.toContain(again);
        expect(edges[0]!.id).toBe(around);
        expect(edges[1]).toMatchObject({ from: 'term-1', to: inner });
        expect(lines.at(-1)).toBe(`edges\t1\t${edges[1]!.id}`);
        // The new frame stands in the old one, whose own line says nothing about what is inside it.
        const row = (await post('node', ['list'])).lines.find((line) => line.startsWith(`${inner}\t`))!;
        expect(row.split('\t').at(-1)).toBe(outer);
    });
});

describe('node arrange', () => {
    test('lays the nodes out from the corner they already occupied and prints where each one went', async () => {
        await seed(box('a', 1000, 1000), box('b', 4000, 2000), box('c', 2000, 3000));
        expect((await post('node', ['list'])).lines).toContain('b\tnote\tb\t4000\t2000\t200\t100\t');

        const { status, lines } = await post('node', ['arrange', '--nodes', 'a,b,c']);
        expect(status).toBe(200);
        // Two columns for three nodes, 40 px apart, starting at the top left of the box they filled.
        expect(lines).toEqual(['a\t1000\t1000', `b\t${1000 + 200 + PLACEMENT_GAP}\t1000`, `c\t1000\t${1000 + 100 + PLACEMENT_GAP}`]);
        expect(await nodeOnDisk('b')).toMatchObject({ x: 1240, y: 1000, w: 200, h: 100 });
    });

    test('--layout row and column are one row and one column', async () => {
        await seed(box('a', 0, 0), box('b', 500, 500));
        expect((await post('node', ['arrange', '--nodes', 'a,b', '--layout', 'row'])).lines).toEqual(['a\t0\t0', 'b\t240\t0']);
        expect((await post('node', ['arrange', '--nodes', 'a,b', '--layout', 'column'])).lines).toEqual(['a\t0\t0', 'b\t0\t140']);
    });

    test('--cols is the grid and nothing else', async () => {
        await seed(box('a', 0, 0), box('b', 500, 500), box('c', 900, 100));
        expect((await post('node', ['arrange', '--nodes', 'a,b,c', '--cols', '3'])).lines).toEqual(['a\t0\t0', 'b\t240\t0', 'c\t480\t0']);

        const wrongLayout = await post('node', ['arrange', '--nodes', 'a,b,c', '--layout', 'row', '--cols', '2']);
        expect(wrongLayout.status).toBe(422);
        expect(wrongLayout.lines[0]).toBe('refused\tflag-not-for-layout\t--cols does not go with row; a row is one row and a column is one column');

        const tooMany = await post('node', ['arrange', '--nodes', 'a,b', '--cols', '5']);
        expect(tooMany.lines[0]).toBe('refused\ttoo-many-columns\t--cols is 5 and you named 2 nodes; a grid holds at most one column per node');
        expect((await post('node', ['arrange', '--nodes', 'a', '--cols', 'two'])).lines[0]).toStartWith('refused\tbad-arguments\t--cols needs a whole number');
        expect((await post('node', ['arrange', '--nodes', 'a', '--layout', 'circle'])).lines[0]).toStartWith('refused\tbad-arguments\t--layout takes one of');
    });

    test('keeps the sizes and never lets two of them touch', async () => {
        await seed(box('wide', 0, 0, { w: 560, h: 360 }), box('tall', 100, 100, { w: 200, h: 520 }), box('small', 50, 50));
        await post('node', ['arrange', '--nodes', 'wide,tall,small', '--layout', 'row']);
        const nodes = await Promise.all(['wide', 'tall', 'small'].map(nodeOnDisk));
        expect(nodes.map((node) => [node!.w, node!.h])).toEqual([
            [560, 360],
            [200, 520],
            [200, 100]
        ]);
        const gaps = nodes.slice(1).map((node, index) => node!.x - (nodes[index]!.x + nodes[index]!.w));
        expect(gaps).toEqual([PLACEMENT_GAP, PLACEMENT_GAP]);
    });

    test('a group carries what stands in it, so it is not something to arrange', async () => {
        await seed(box('a', 0, 0), box('frame', 300, 300, { kind: 'group', w: 800, h: 800 }));
        const { status, lines } = await post('node', ['arrange', '--nodes', 'a,frame']);
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tnot-arrangeable\tframe is a group and carries whatever stands inside it');
        expect(await nodeOnDisk('a')).toMatchObject({ x: 0, y: 0 });
    });

    test('nodes that already stand where this would put them are reported and nothing is written', async () => {
        await seed(box('a', 0, 0), box('b', 240, 0));
        await post('node', ['arrange', '--nodes', 'a,b', '--layout', 'row']);
        const rev = (await onDisk()).rev;
        const { lines } = await post('node', ['arrange', '--nodes', 'a,b', '--layout', 'row']);
        expect(lines).toEqual(['a\t0\t0', 'b\t240\t0']);
        expect((await onDisk()).rev).toBe(rev);
    });

    test('refuses an id that is not on the canvas and takes no dry run', async () => {
        expect((await post('node', ['arrange', '--nodes', 'ghost'])).lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
        expect((await post('node', ['arrange', '--nodes', 'note-1', '--dry-run'])).lines[0]).toStartWith('refused\tno-dry-run\t');
        expect((await post('node', ['arrange'])).lines[0]).toBe('refused\tbad-arguments\t--nodes needs one or more node ids, separated by commas');
    });
});

describe('node edit', () => {
    test('writes the body of a note the caller made, escapes and all', async () => {
        const id = (await post('node', ['new', 'note', '--text', 'first'])).lines[0]!.split('\t')[0]!;
        const { status, lines } = await post('node', ['edit', id, '--text', 'one\\ntwo']);
        expect(status).toBe(200);
        expect(lines).toEqual([`edited\t${id}\t2\t7`]);
        expect((await nodeOnDisk(id))?.body).toBe('one\ntwo');
    });

    test('--append writes a line under what is there and leaves the rest standing', async () => {
        await post('link', ['new', '--to', 'note-1']);
        expect((await post('node', ['edit', 'note-1', '--text', 'mine', '--append'])).lines).toEqual(['edited\tnote-1\t2\t6']);
        expect((await nodeOnDisk('note-1'))?.body).toBe('x\nmine');
        const empty = (await post('node', ['new', 'note'])).lines[0]!.split('\t')[0]!;
        expect((await post('node', ['edit', empty, '--text', 'first', '--append'])).lines).toEqual([`edited\t${empty}\t1\t5`]);
        expect((await nodeOnDisk(empty))?.body).toBe('first');
    });

    test('two appends at the same moment both land, neither over the other', async () => {
        await post('link', ['new', '--to', 'note-1']);
        const answers = await Promise.all(
            ['from the chat', 'from the shell', 'from a third'].map((text) => post('node', ['edit', 'note-1', '--text', text, '--append']))
        );
        // Each call counted a note one line longer than the one before it, so none of them wrote against a body that was already stale.
        expect(answers.map(({ lines }) => Number(lines[0]!.split('\t')[2])).sort()).toEqual([2, 3, 4]);
        expect((await nodeOnDisk('note-1'))?.body?.split('\n').sort()).toEqual(['from a third', 'from the chat', 'from the shell', 'x']);
    });

    test('a note the caller did not make takes a line, whichever way it runs', async () => {
        const refused = await post('node', ['edit', 'note-1', '--text', 'mine']);
        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe(
            'refused\tnot-linked\tnote-1 is a note you did not make and no line joins you to it: draw that line and you can write in it'
        );
        expect(refused.lines).toContain('note\tmain has no note you may write in; ruimte-context node new note --text B adds one of your own');
        expect(refused.lines).toContain('see\truimte-context link new --to note-1\tdraws the line this needs');
        // The line a person drew from the note into this session says the same thing as one the other way.
        await post('link', ['new', '--from', 'note-1', '--to', 'term-1']);
        expect((await post('node', ['edit', 'note-1', '--text', 'mine'])).status).toBe(200);
        expect((await nodeOnDisk('note-1'))?.body).toBe('mine');
    });

    test('only a note, and only one that is on the canvas', async () => {
        const wrong = await post('node', ['edit', 'term-1', '--text', 'x']);
        expect(wrong.status).toBe(422);
        expect(wrong.lines[0]).toBe(
            'refused\tnot-a-note\tterm-1 is a terminal node and only a note holds a body to write; what a file, a browser, a terminal or a chat shows is not yours to set'
        );
        expect((await post('node', ['edit', 'ghost', '--text', 'x'])).lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
        expect((await onDisk()).rev).toBe(1);
    });

    test('one note per call, and the body it already carries writes nothing', async () => {
        await post('link', ['new', '--to', 'note-1']);
        const rev = (await onDisk()).rev;
        expect((await post('node', ['edit', 'note-1', '--text', 'x'])).lines).toEqual(['edited\tnote-1\t1\t1']);
        expect((await onDisk()).rev).toBe(rev);
        expect((await post('node', ['edit', 'note-1'])).lines[0]).toBe('refused\tbad-arguments\t--text needs the body to write, in quotes');
        expect((await post('node', ['edit', 'note-1', 'note-2', '--text', 'x'])).lines[0]).toBe(
            'refused\tbad-arguments\tnode edit takes one node id and nothing else; the body goes in --text'
        );
        expect((await post('node', ['edit', '--text', 'x'])).lines[0]).toBe('refused\tbad-arguments\tnode edit needs the id of a note');
        expect((await post('node', ['edit', 'note-1', '--text=', '--append'])).lines[0]).toBe(
            'refused\tbad-arguments\t--append has nothing to add: --text is empty; leave --append off to empty the note'
        );
        // Without --append an empty --text is what empties a note again.
        expect((await post('node', ['edit', 'note-1', '--text='])).lines).toEqual(['edited\tnote-1\t0\t0']);
        expect((await nodeOnDisk('note-1'))?.body).toBe('');
    });
});

describe('node rename', () => {
    test('names a node for good, so the session never renames over it', async () => {
        const { status, lines } = await post('node', ['rename', 'term-1', '--title', 'Build the parser']);
        expect(status).toBe(200);
        expect(lines).toEqual(['term-1\tterminal\tBuild the parser']);
        expect(await nodeOnDisk('term-1')).toMatchObject({ title: 'Build the parser', titleSource: 'user' });
    });

    test('the title it already carries writes nothing', async () => {
        await post('node', ['rename', 'note-1', '--title', 'Plan']);
        const rev = (await onDisk()).rev;
        const { lines } = await post('node', ['rename', 'note-1', '--title', 'Plan']);
        expect(lines).toEqual(['note-1\tnote\tPlan']);
        expect((await onDisk()).rev).toBe(rev);
    });

    test('one node per call, by id, with the same cap on a name as everywhere else', async () => {
        const missing = await post('node', ['rename', 'shell', '--title', 'x']);
        expect(missing.status).toBe(422);
        expect(missing.lines[0]).toBe('refused\tunknown-node\tshell is not a node on main');
        expect(missing.lines.slice(1)).toContain('node\tterm-1\tterminal\tshell');
        expect((await post('node', ['rename', 'term-1', '--title', 'x'.repeat(MAX_TITLE_LENGTH + 1)])).lines[0]).toBe(
            `refused\tbad-arguments\t--title is ${MAX_TITLE_LENGTH + 1} characters and at most ${MAX_TITLE_LENGTH} fit in a name on the canvas`
        );
        expect((await post('node', ['rename', 'term-1'])).lines[0]).toBe('refused\tbad-arguments\t--title needs a title');
        expect((await post('node', ['rename', '--title', 'x'])).lines[0]).toBe('refused\tbad-arguments\tnode rename needs the id of a node');
        expect((await post('node', ['rename', 'term-1', 'note-1', '--title', 'x'])).lines[0]).toBe(
            'refused\tbad-arguments\tnode rename takes one node id and nothing else; the title goes in --title'
        );
        expect((await onDisk()).rev).toBe(1);
    });
});

describe('notify', () => {
    test('a message travels along a line from the caller and nowhere else', async () => {
        const [target, , , drawn] = (await post('node', ['new', 'terminal', '--title', 'builder'])).lines[0]!.split('\t') as [string, string, string, string];
        // node new drew the line this travels along, so it goes again: without one there is nothing to notify along.
        expect((await post('link', ['delete', drawn])).lines[0]).toStartWith('deleted\t');
        const refused = await post('notify', [target, '--text', 'the build is green']);
        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe(
            `refused\tnot-linked\t${target} is a terminal node on main, but no line runs from you into it: draw that line and it can be notified`
        );
        expect(refused.lines).toContain(
            `note\tNothing on main has a line from you into it yet; ruimte-context link new --to ${target} draws the one this call needs`
        );
        expect(refused.lines).toContain(`see\truimte-context link new --to ${target}\tdraws the line this needs`);
        expect(notified).toEqual([]);

        await post('link', ['new', '--to', target]);
        const sent = await post('notify', [target, '--text', 'the build is green']);
        expect(sent.status).toBe(200);
        expect(sent.lines).toEqual([`notified\t${target}\twaiting\t${delivery.detail}`]);
        // The sender goes along by id, with its title only so the receiver can read the line.
        expect(notified).toEqual([{ projectId, targetId: target, from: 'term-1', fromTitle: 'shell', text: 'the build is green' }]);
    });

    test('says where the message landed, in the words the daemon gave it', async () => {
        const target = (await post('node', ['new', 'terminal'])).lines[0]!.split('\t')[0]!;
        await post('link', ['new', '--to', target]);
        delivery = { at: 'now', wake: false, detail: 'printed on the screen of that terminal' };
        expect((await post('notify', [target, '--text', 'look at the log'])).lines).toEqual([
            `notified\t${target}\tnow\tprinted on the screen of that terminal`
        ]);
    });

    test('refuses a node that is not there, is not an agent, or is the caller itself', async () => {
        const unknown = await post('notify', ['nowhere', '--text', 'hi']);
        expect(unknown.lines[0]).toBe('refused\tunknown-node\tnowhere is not a node on main');
        const plain = await post('notify', ['note-1', '--text', 'hi']);
        expect(plain.lines[0]).toBe('refused\tnot-an-agent\tnote-1 is a note node; only a terminal or a chat has an agent that could read a message');
        const self = await post('notify', ['term-1', '--text', 'hi']);
        expect(self.lines[0]).toBe('refused\tself-notify\tterm-1 is you; a node needs no message to itself');
        expect(notified).toEqual([]);
    });

    test('a caller that is a view of its own has no line to travel', async () => {
        const { status, lines } = await post('notify', ['term-1', '--text', 'hi'], 'chat');
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tnot-on-a-canvas\tA message travels along a line between two nodes of one canvas, and this view has none');
    });

    test('a chat that is a view of its own cannot be notified, and the refusal says why in one sentence', async () => {
        const { status, lines } = await post('notify', ['chat-1', '--text', 'hi']);
        expect(status).toBe(422);
        expect(lines[0]).toBe(
            'refused\tnot-on-a-canvas\tchat-1 is a chat that is a view of its own, not a node on any canvas of this project, so no line can run from you into it, and that is what a message travels along'
        );
        expect(notified).toEqual([]);
        // An id this project has nowhere is the other case and keeps its own sentence.
        expect((await post('notify', ['nowhere', '--text', 'hi'])).lines[0]).toBe('refused\tunknown-node\tnowhere is not a node on main');
    });

    test('help notify names the whole set of refusals it can answer with, and what it cannot promise', async () => {
        const lines = (await post('help', ['notify'])).lines;
        const refusals = lines
            .find((line) => line.startsWith('refusals\t'))!
            .split('\t')
            .slice(1);
        for (const code of ['not-linked', 'self-notify', 'not-an-agent', 'unknown-node', 'not-on-a-canvas']) {
            expect(refusals).toContain(code);
        }
        expect(lines.some((line) => line.startsWith('not\t') && line.includes('never hear that it was read'))).toBe(true);
        expect(lines.some((line) => line.startsWith('reply\t') && line.includes('no reply channel'))).toBe(true);
        expect(lines.some((line) => line.startsWith('who\t') && line.includes('draws both ways at once'))).toBe(true);
        expect(lines.some((line) => line.startsWith('terminal\t') && line.includes('wrapped across lines'))).toBe(true);
    });

    test('the message is one argument, present, and short enough to read in a turn', async () => {
        expect((await post('notify', ['note-1'])).lines[0]).toBe('refused\tbad-arguments\t--text needs the message to leave, in quotes');
        expect((await post('notify', ['--text', 'hi'])).lines[0]).toBe('refused\tbad-arguments\tnotify takes the id of the node to notify');
        expect((await post('notify', ['a', 'b', '--text', 'hi'])).lines[0]).toBe(
            'refused\tbad-arguments\tnotify takes one id and nothing else; the message goes in --text'
        );
        expect((await post('notify', ['note-1', '--text', 'x'.repeat(MAX_NOTICE_LENGTH + 1)])).lines[0]).toStartWith(
            `refused\tbad-arguments\t--text is ${MAX_NOTICE_LENGTH + 1} characters and a message is at most ${MAX_NOTICE_LENGTH}`
        );
        expect(notified).toEqual([]);
    });
});

describe('node delete', () => {
    test('removes a node the caller made, with the lines that ran into it', async () => {
        const note = (await post('node', ['new', 'note', '--title', 'Scratch'])).lines[0]!.split('\t')[0]!;
        await post('link', ['new', '--to', note]);
        const { status, lines } = await post('node', ['delete', note]);
        expect(status).toBe(200);
        expect(lines).toEqual([`deleted\t${note}\tnote\tScratch`, 'edges\t1']);
        const canvas = await canvasOnDisk();
        expect(canvas.nodes.some((node) => node.id === note)).toBe(false);
        expect(canvas.edges).toEqual([]);
    });

    test('a terminal node it made stops before the canvas lets go of it', async () => {
        const made = (await post('node', ['new', 'terminal', '--title', 'runner'])).lines[0]!.split('\t')[0]!;
        const { lines } = await post('node', ['delete', made]);
        // The line node new drew from the caller goes with it.
        expect(lines).toEqual([`deleted\t${made}\tterminal\trunner`, `ended\t${made}\tterminal`, 'edges\t1']);
        expect(ended).toEqual([`terminal\t${made}`]);
    });

    test('a node the caller did not make stays, unless the machine frees every one', async () => {
        const refused = await post('node', ['delete', 'note-1']);
        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe('refused\tnot-yours\tnote-1 was made by a person and node delete only removes a node you made yourself');
        expect(refused.lines).toContain('made by\ta person');
        expect(refused.lines[3]).toStartWith("setting\tagentsDeleteAnyView in this machine's endpoint.json frees every node and view");
        expect((await canvasOnDisk()).nodes.some((node) => node.id === 'note-1')).toBe(true);

        deleteAnyView = true;
        expect((await post('node', ['delete', 'note-1'])).lines[0]).toBe('deleted\tnote-1\tnote\tPlan with a tab');
    });

    test('never the caller itself, and never an id no canvas has', async () => {
        const self = await post('node', ['delete', 'term-1']);
        expect(self.lines[0]).toBe('refused\tdeletes-caller\tYou are term-1, so removing it would end the session asking');
        const nowhere = await post('node', ['delete', 'nope']);
        expect(nowhere.lines[0]).toBe('refused\tunknown-node\tnope is not a node on any canvas of this project');
        // Nothing it could not delete anyway: the caller's own node and a person's note are both out.
        expect(nowhere.lines.slice(1)).toEqual(['note\tYou have no node on main to remove; node delete takes a node you made yourself']);
        // A chat the sidebar holds is no node either, and the refusal says which of the two it is.
        const own = await post('node', ['delete', 'chat-1']);
        expect(own.lines[0]).toBe(
            'refused\tnot-on-a-canvas\tchat-1 is a chat that is a view of its own, not a node on any canvas of this project, so there is no node to remove'
        );
        expect(own.lines.at(-1)).toBe('see\truimte-context view delete chat-1\tremoves a view you made, with the session it holds');
        const mine = (await post('node', ['new', 'note', '--title', 'Mine'])).lines[0]!.split('\t')[0]!;
        expect((await post('node', ['delete', 'nope'])).lines.slice(1)).toEqual([`node\t${mine}\tnote\tMine`]);
    });

    test('a group loses its frame and keeps its nodes where they stand', async () => {
        const first = (await post('node', ['new', 'note', '--title', 'One'])).lines[0]!.split('\t')[0]!;
        const second = (await post('node', ['new', 'note', '--title', 'Two'])).lines[0]!.split('\t')[0]!;
        const group = (await post('node', ['group', '--nodes', `${first},${second}`, '--label', 'Work'])).lines[0]!.split('\t')[0]!;
        const { lines } = await post('node', ['delete', group]);
        // The one line node group drew in place of the two into the notes goes with the frame.
        expect(lines).toEqual([`deleted\t${group}\tgroup\tWork`, 'edges\t1', 'members\t2\tleft where they stand']);
        const nodes = (await canvasOnDisk()).nodes.map((node) => node.id);
        expect(nodes).toContain(first);
        expect(nodes).toContain(second);
        expect(nodes).not.toContain(group);
    });
});

describe('link delete', () => {
    const newNode = async (kind: string, token = 'term', argv: string[] = []): Promise<string> =>
        (await post('node', ['new', kind, ...argv], token)).lines[0]!.split('\t')[0]!;

    const edgeIds = async (id = 'main'): Promise<string[]> => (await canvasOnDisk(id)).edges.map((edge) => edge.id);

    test('removes a line between nodes the caller made, and prints the line that went', async () => {
        const note = await newNode('note');
        const other = await newNode('note');
        const edge = (await post('link', ['new', '--from', note, '--to', other, '--label', 'plan'])).lines[0]!.split('\t')[0]!;
        const { status, lines } = await post('link', ['delete', edge]);
        expect(status).toBe(200);
        expect(lines).toEqual([`deleted\t${edge}\t${note}\t${other}\tplan`]);
        // What node new drew from the caller into each of them stays; only the line this named went.
        expect(await edgeIds()).toHaveLength(2);
        // Both ends stay.
        expect((await canvasOnDisk()).nodes.map((node) => node.id)).toContain(note);
    });

    test('between two agents it removes the one direction it is given and leaves the other', async () => {
        const shell = await newNode('terminal');
        const [out, back] = (await post('link', ['new', '--to', shell])).lines.map((line) => line.split('\t')[0]!);
        expect((await post('link', ['delete', out!])).lines).toEqual([`deleted\t${out}\tterm-1\t${shell}\tcontext`]);
        expect(await edgeIds()).toEqual([back!]);
    });

    test('a line that touches a node a person or another agent made stays, unless the machine frees every one', async () => {
        const into = (await post('link', ['new', '--to', 'note-1'])).lines[0]!.split('\t')[0]!;
        const refused = await post('link', ['delete', into]);
        expect(refused.status).toBe(422);
        expect(refused.lines).toEqual([
            `refused\tnot-yours\t${into} runs into note-1, which a person made, and link delete only removes a line whose ends are both yours`,
            'made by\tnote-1\ta person',
            'you\tterm-1',
            "setting\tagentsDeleteAnyView in this machine's endpoint.json frees every node, view and line; a person turns it on from the Machines pane"
        ]);

        // The context a person gave the caller is theirs, even though the caller is one of its ends.
        const given = (await post('link', ['new', '--from', 'note-1', '--to', 'term-1'])).lines[0]!.split('\t')[0]!;
        expect((await post('link', ['delete', given])).lines[0]).toStartWith(`refused\tnot-yours\t${given} runs from note-1, which a person made,`);

        const theirs = await newNode('note', 'chat', ['--view', 'main']);
        const toTheirs = (await post('link', ['new', '--to', theirs])).lines[0]!.split('\t')[0]!;
        expect((await post('link', ['delete', toTheirs])).lines[0]).toStartWith(`refused\tnot-yours\t${toTheirs} runs into ${theirs}, which chat-1 made,`);
        expect(await edgeIds()).toEqual([into, given, toTheirs]);

        deleteAnyView = true;
        expect((await post('link', ['delete', into])).lines).toEqual([`deleted\t${into}\tterm-1\tnote-1\t`]);
        expect(await edgeIds()).toEqual([given, toTheirs]);
    });

    test('an id that is no line is refused with only the lines this call would remove', async () => {
        const empty = await post('link', ['delete', 'nope']);
        expect(empty.lines).toEqual(['refused\tunknown-edge\tnope is not a line on main', 'note\tmain has no lines on it']);

        await post('link', ['new', '--to', 'note-1']);
        expect((await post('link', ['delete', 'nope'])).lines.slice(1)).toEqual([
            'note\tYou have no line on main to remove; link delete takes a line whose ends are both yours'
        ]);

        const note = await newNode('note');
        const mine = (await post('link', ['new', '--to', note])).lines[0]!.split('\t')[0]!;
        expect((await post('link', ['delete', 'nope'])).lines.slice(1)).toEqual([`edge\t${mine}\tterm-1\t${note}\t`]);
        // A node id is not a line id.
        expect((await post('link', ['delete', note])).lines[0]).toBe(`refused\tunknown-edge\t${note} is not a line on main`);
    });

    test('finds the canvas the way link new does, and takes one id and nothing that would make it a dry run', async () => {
        const note = await newNode('note', 'term', ['--view', 'board']);
        const other = await newNode('note', 'term', ['--view', 'board']);
        const line = (await post('link', ['new', '--from', note, '--to', other, '--view', 'board'])).lines[0]!.split('\t')[0]!;
        expect((await post('link', ['delete', line])).lines[0]).toBe(`refused\tunknown-edge\t${line} is not a line on main`);
        expect((await post('link', ['delete', line], 'chat')).lines[0]).toStartWith('refused\tview-required\t');
        expect((await post('link', ['delete', line, '--view', 'sketch-1'])).lines[0]).toBe('refused\tnot-a-canvas\tsketch-1 is not a canvas of this project');
        expect((await post('link', ['delete', line, '--view', 'board'])).lines).toEqual([`deleted\t${line}\t${note}\t${other}\t`]);
        expect(await edgeIds('board')).toEqual([]);

        expect((await post('link', ['delete'])).lines[0]).toBe('refused\tbad-arguments\tlink delete needs the id of a line');
        expect((await post('link', ['delete', 'a', 'b'])).lines[0]).toBe('refused\tbad-arguments\tlink delete takes one line id and nothing else');
        expect((await post('link', ['delete', 'a', '--dry-run'])).lines[0]).toStartWith('refused\tno-dry-run\t');
        expect((await post('link', ['delete', 'a'], 'stray')).lines[0]).toStartWith('refused\tnot-in-project\t');
    });
});

describe('view diagram', () => {
    const doc = (overrides: Record<string, unknown> = {}): string =>
        JSON.stringify({
            meta: { title: 'Wire', direction: 'down' },
            nodes: [
                { id: 'web', label: 'Web' },
                { id: 'api', label: 'API' }
            ],
            groups: [{ id: 'back', label: 'Back', wraps: ['api'] }],
            edges: [{ from: 'web', to: 'api' }],
            ...overrides
        });

    const write = (viewId: string, document: string, token = 'term'): Promise<{ status: number; lines: string[] }> =>
        post('view', ['diagram', viewId, `--document=${document}`], token);

    /* Nothing a verb makes is shared, so its diagram sits on the private side of the folder. */
    const diagramOnDisk = async (viewId: string, base = folder): Promise<unknown> =>
        readFile(join(base, '.ruimte', 'private', 'diagrams', `${viewId}.json`), 'utf8')
            .then((text) => JSON.parse(text))
            .catch(() => null);

    test('help diagram names every field of the document and every value a closed field takes', async () => {
        const { lines } = await post('help', ['view', 'diagram']);
        const shapes = {
            'meta.': DiagramMetaSchema.shape,
            'nodes[].': DiagramNodeSchema.shape,
            'groups[].': DiagramGroupSchema.shape,
            'edges[].': DiagramEdgeSchema.shape
        };
        for (const [prefix, shape] of Object.entries(shapes)) {
            for (const key of Object.keys(shape)) {
                expect(lines.some((line) => line.startsWith(`field\t${prefix}${key}\t`))).toBe(true);
            }
        }
        const text = lines.join('\n');
        for (const value of [...DIAGRAM_SHAPES, ...DrawingColorSchema.options, ...DiagramEdgeStyleSchema.options, ...DiagramDirectionSchema.options]) {
            expect(text).toInclude(value);
        }
        expect(lines.find((line) => line.startsWith('field\tnodes[].pos\t'))).toInclude('Only a person');
        expect(text).toInclude('loses a position a person dragged it to');
    });

    test('the example in the help is a document the verb takes', async () => {
        const id = await made('Flow', ['--kind', 'diagram']);
        expect((await write(id, DIAGRAM_EXAMPLE)).lines).toEqual([`${id}\t1\t3\t1\t2`]);
    });

    test('a valid document lands on disk at rev + 1 in a released project, and every client hears it', async () => {
        const id = await made('Flow', ['--kind', 'diagram']);
        expect(await write(id, doc())).toEqual({ status: 200, lines: [`${id}\t1\t2\t1\t1`] });
        expect(await diagramOnDisk(id)).toMatchObject({ version: 1, rev: 1, meta: { direction: 'down' }, nodes: [{ id: 'web' }, { id: 'api' }] });
        expect((await write(id, doc({ edges: [] }))).lines).toEqual([`${id}\t2\t2\t1\t0`]);
        expect(diagramEvents.map((event) => event.event)).toEqual(['diagram.changed', 'diagram.changed']);
        expect(diagramEvents[1]).toMatchObject({ payload: { projectId, viewId: id, document: { rev: 2 } } });
    });

    test('a project a client had open and let go of is written all the same, and the client hears it', async () => {
        const id = await made('Flow', ['--kind', 'diagram']);
        await store.openProject({ projectId });
        await diagrams.open(projectId, id);
        store.release(projectId);
        expect((await write(id, doc())).lines).toEqual([`${id}\t1\t2\t1\t1`]);
        expect(diagramEvents).toHaveLength(1);
        expect(diagramEvents[0]).toMatchObject({ event: 'diagram.changed', payload: { projectId, viewId: id, document: { rev: 1 } } });
    });

    test('version and rev read back from the file are ignored, since the rev is the daemon’s', async () => {
        const id = await made('Flow', ['--kind', 'diagram']);
        await write(id, doc());
        const fromDisk = { ...((await diagramOnDisk(id)) as object), rev: 40 };
        expect((await write(id, JSON.stringify(fromDisk))).lines).toEqual([`${id}\t2\t2\t1\t1`]);
    });

    test('an edge to an id that is no node is refused with that id, and nothing is written', async () => {
        const id = await made('Flow', ['--kind', 'diagram']);
        const { status, lines } = await write(id, doc({ edges: [{ from: 'web', to: 'ghost' }] }));
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tdiagram-invalid\tThe edge from "web" to "ghost" names "ghost", which is not a node');
        expect(await diagramOnDisk(id)).toBeNull();
        expect(diagramEvents).toEqual([]);
    });

    test('a document that breaks the schema is refused by path, with the item it is about and what may go there', async () => {
        const id = await made('Flow', ['--kind', 'diagram']);
        const { lines } = await write(
            id,
            doc({
                nodes: [
                    { id: 'web', label: 'Web' },
                    { id: 'api', lable: 'API', shape: 'hexagon' }
                ],
                edges: [{ from: 'web', to: 'api', style: 'wavy' }]
            })
        );
        expect(lines[0]).toStartWith('refused\tbad-document\tnodes[1]');
        const problems = lines.filter((line) => line.startsWith('problem\t'));
        expect(problems).toContain(`problem\tnodes[1].shape\ttakes one of ${DIAGRAM_SHAPES.join(', ')} (node "api")`);
        expect(problems).toContain('problem\tnodes[1].label\tis missing and needs a string (node "api")');
        expect(problems).toContain('problem\tnodes[1]\thas no field lable (node "api")');
        expect(problems.some((line) => line.startsWith('problem\tedges[0].style\t') && line.endsWith('(the edge from "web" to "api")'))).toBe(true);
        expect(lines.at(-1)).toBe('detail\truimte-context help view diagram');
        for (const line of lines) {
            expect(line).not.toInclude('Invalid');
            expect(line).not.toInclude('expected');
        }
        expect(await diagramOnDisk(id)).toBeNull();
    });

    test('no document, one that is not JSON, one that is not an object and a --dry-run are each refused by name', async () => {
        const id = await made('Flow', ['--kind', 'diagram']);
        expect((await post('view', ['diagram', id])).lines[0]).toStartWith('refused\tno-document\t');
        expect((await write(id, '  \n')).lines[0]).toStartWith('refused\tno-document\t');
        expect((await write(id, '{ nodes: [')).lines[0]).toStartWith('refused\tbad-json\tThe document is not JSON: ');
        expect((await write(id, '[]')).lines[0]).toBe('refused\tbad-document\tdocument needs to be one JSON object with meta, nodes, groups and edges');
        expect((await write(id, JSON.stringify({ nodes: [], groups: [], edges: [] }))).lines[0]).toBe(
            'refused\tbad-document\tmeta is missing and needs an object'
        );
        expect((await post('view', ['diagram', id, '--dry-run', `--document=${doc()}`])).lines[0]).toStartWith('refused\tno-dry-run\t');
    });

    test('a view that is no diagram, or a diagram of another project, is refused with the diagrams of this one', async () => {
        expect((await write('sketch-1', doc())).lines).toEqual([
            'refused\tnot-a-diagram\tsketch-1 is not a diagram view of this project',
            'note\tThis project has no diagram view; ruimte-context view new <name> --kind diagram makes one'
        ]);
        const id = await made('Flow', ['--kind', 'diagram']);
        expect((await write('sketch-1', doc())).lines.slice(1)).toEqual([`view\t${id}\tdiagram\tFlow`]);

        const otherFolder = join(root, 'other');
        await mkdir(otherFolder);
        const other = await store.openProject({ folder: otherFolder });
        await store.save(other.summary.projectId, other.document.rev, {
            name: 'other',
            color: '#654321',
            views: [{ kind: 'diagram', id: 'theirs', name: 'Theirs' }]
        });
        store.release(other.summary.projectId);
        expect((await write('theirs', doc())).lines[0]).toBe('refused\tnot-a-diagram\ttheirs is not a diagram view of this project');
        expect(await diagramOnDisk('theirs', otherFolder)).toBeNull();
    });

    test('a session that is in no project of this machine writes nothing', async () => {
        const id = await made('Flow', ['--kind', 'diagram']);
        expect((await write(id, doc(), 'stray')).lines[0]).toStartWith('refused\tnot-in-project\t');
        expect(await diagramOnDisk(id)).toBeNull();
    });
});

describe('task list', () => {
    // The chat view `chat-1` is a chat, the one kind of caller that can be woken with a result.
    const give = (argv: string[]) => post('agent', ['claude', '--view', 'main', ...argv], 'chat');

    test('agent --task from a chat records an open task, titles the node after it and tells the child how to report back', async () => {
        const { status, lines } = await give(['--task', 'Lexer', '--prompt', 'fix the tokenizer']);
        expect(status).toBe(200);
        expect(lines).toHaveLength(2);
        expect(lines[1]).toBe(nextLine(false));
        const [id, kind, , , , taskId] = lines[0]!.split('\t');
        expect(kind).toBe('chat');
        expect(tasks.get(taskId!)).toMatchObject({
            parentId: 'chat-1',
            childId: id,
            title: 'Lexer',
            prompt: 'fix the tokenizer',
            status: 'open',
            wake: 'pending'
        });
        expect((await canvasOnDisk()).nodes.find((node) => node.id === id)?.title).toBe('Lexer');
        // The record keeps the assignment as it was given; only the child hears how to report back.
        expect(held).toEqual([{ projectId, nodeId: id!, prompt: `fix the tokenizer${taskBrief(true)}` }]);
    });

    test('a terminal agent cannot give a task, since nothing can wake it with the result', async () => {
        const { status, lines } = await post('agent', ['claude', '--task', 'Lexer', '--prompt', 'fix it']);
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tnot-a-chat-parent\tOnly a chat can give a task, and you are a terminal');
        expect(started).toEqual([]);
        expect((await post('team', ['--label', 'Crew', '--task', '--roles', ROLES_SHAPE])).lines[0]).toStartWith('refused\tnot-a-chat-parent\t');
    });

    test('a task needs a prompt that leaves room for the line about reporting back', async () => {
        expect((await give(['--task', 'Lexer'])).lines[0]).toStartWith('refused\ttask-needs-prompt\t');
        const long = 'x'.repeat(MAX_TASK_PROMPT_LENGTH + 1);
        expect((await give(['--task', 'Lexer', '--prompt', long])).lines[0]).toStartWith('refused\tprompt-too-long\t');
        expect((await give(['--task', 'Lexer', '--prompt', 'go', '--dry-run'])).lines[0]).toEndWith('\t<new task>');
        expect(tasks.involving('chat-1')).toEqual([]);
    });

    test('the brief fits the room kept for it, sends a chat to its last answer and a terminal to done in plain quotes', () => {
        for (const chat of [true, false]) {
            expect(taskBrief(chat).length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH - MAX_TASK_PROMPT_LENGTH);
        }
        // A child that is told about done calls it even when its last answer already reports back.
        expect(taskBrief(true)).not.toContain('done');
        // Codex's allow rule cannot read $'...', so that call would wait on a person's approval.
        expect(taskBrief(false)).toContain("ruimte-context done --result '...'");
        expect(taskBrief(false)).toContain('\\n');
    });

    test('team --task gives every role a task of its own', async () => {
        const roles = JSON.stringify([
            { title: 'Lexer', prompt: 'fix the tokenizer', provider: 'claude', terminal: true },
            { title: 'Docs', prompt: 'write the docs', provider: 'claude' }
        ]);
        const { lines } = await post('team', ['--label', 'Crew', '--task', '--roles', roles, '--view', 'main'], 'chat');
        const rows = lines.slice(1, -1).map((line) => line.split('\t'));
        expect(rows.map((row) => tasks.get(row[6]!)?.title)).toEqual(['Lexer', 'Docs']);
        expect(lines.at(-1)).toBe(nextLine(true));
        expect(held.map((entry) => entry.prompt)).toEqual([`fix the tokenizer${taskBrief(false)}`, `write the docs${taskBrief(true)}`]);
    });

    test('done settles the open task of the caller, and tasks lists it from both sides', async () => {
        const [childId, , , , , taskId] = (await give(['--task', 'Lexer', '--prompt', 'fix it'])).lines[0]!.split('\t');
        TOKENS.child = childId!;
        try {
            expect((await post('done', ['--result', 'no tasks here'], 'term')).lines[0]).toStartWith('refused\tno-open-task\t');
            expect((await post('done', [], 'child')).lines[0]).toStartWith('refused\tempty-result\t');
            expect((await post('done', ['--result', 'Fixed\\nboth bugs'], 'child')).lines).toEqual([`done\t${taskId}\tchat-1`]);
            expect(tasks.get(taskId!)).toMatchObject({ status: 'done', result: { text: 'Fixed\nboth bugs', source: 'done' } });
            expect((await post('done', ['--result', 'again'], 'child')).lines[0]).toStartWith('refused\tno-open-task\t');
            expect((await post('task', ['list'], 'chat')).lines).toEqual([`task\t${taskId}\tgave\tdone\t${childId}\tLexer\tpending\tFixed\t-`]);
            // The child is done with a task that settled, while the parent still waits for the wake.
            expect((await post('task', ['list'], 'child')).lines).toEqual([
                'note\tNo task is open or waiting to wake you; 1 older task is hidden, settled and already reported; ruimte-context task list --all lists them'
            ]);
            expect((await post('task', ['list', '--all'], 'child')).lines).toEqual([`task\t${taskId}\tgiven\tdone\tchat-1\tLexer\tpending\tFixed\t-`]);
            expect((await post('task', ['list'], 'term')).lines).toEqual([
                'note\tYou have given no task and were given none; ruimte-context agent --task gives one'
            ]);
        } finally {
            delete TOKENS.child;
        }
    });
    test('tasks leaves out what settled and already woke the parent, and --all brings the history back', async () => {
        const [, , , , , earlier] = (await give(['--task', 'Lexer', '--prompt', 'fix it'])).lines[0]!.split('\t');
        await tasks.settle(earlier!, 'done', { text: 'Fixed', source: 'done', at: 1 }, 1);
        await tasks.markWoken([earlier!]);
        const [laterChild, , , , , later] = (await give(['--task', 'Lexer', '--prompt', 'fix it again'])).lines[0]!.split('\t');

        expect((await post('task', ['list'], 'chat')).lines).toEqual([
            `task\t${later}\tgave\topen\t${laterChild}\tLexer\tpending\t\t-`,
            'note\t1 older task is hidden, settled and already reported; ruimte-context task list --all lists them'
        ]);
        expect((await post('task', ['list', '--all'], 'chat')).lines.map((line) => line.split('\t')[1])).toEqual([earlier, later]);
    });
});

describe('browser', () => {
    /* A page of the caller's own: `node new` draws the line from the agent to it, which is what driving takes. */
    const ownPage = async (): Promise<string> => (await post('node', ['new', 'browser', '--url', 'https://example.com'])).lines[0]!.split('\t')[0]!;

    test('state prints where the page stands, without asking the page to move', async () => {
        const id = await ownPage();
        const { status, lines } = await post('browser', ['state', id]);
        expect(status).toBe(200);
        expect(lines).toEqual(['open\tyes\tThe page answered', `page\t${id}\thttps://example.com/two\tTwo`, 'loading\tno', 'back\tyes', 'forward\tno']);
        expect(driven).toEqual([{ browserId: id, action: { kind: 'state' } }]);
    });

    test('go sends the page to an address and answers where it landed', async () => {
        const id = await ownPage();
        const { lines } = await post('browser', ['go', id, '--url', 'https://example.com/two']);
        expect(driven).toEqual([{ browserId: id, action: { kind: 'go', url: 'https://example.com/two' } }]);
        expect(lines[1]).toBe(`page\t${id}\thttps://example.com/two\tTwo`);
    });

    test('go on a node that has no address yet writes that address into the project', async () => {
        // The node a person's splash makes: a browser with no page at all, with a line from the agent to it.
        await store.mutate(projectId, (current) => ({
            content: {
                ...current,
                views: current.views.map((view) =>
                    view.id === 'main' && view.kind === 'canvas'
                        ? {
                              ...view,
                              nodes: [...view.nodes, { id: 'page-blank', kind: 'browser' as const, title: 'Page', x: 900, y: 0, w: 560, h: 360 }],
                              edges: [...view.edges, { id: 'edge-blank', from: 'term-1', to: 'page-blank' }]
                          }
                        : view
                )
            },
            result: undefined
        }));
        const { lines } = await post('browser', ['go', 'page-blank', '--url', 'https://example.com/start']);
        expect(driven).toEqual([]);
        expect(lines[0]).toBe('open\tno\tThis node had no address yet, so https://example.com/start is now the page it opens with');
        expect((await canvasOnDisk()).nodes.find((node) => node.id === 'page-blank')?.url).toBe('https://example.com/start');
    });

    test('reload --hard asks past the cache, and the plain one does not', async () => {
        const id = await ownPage();
        await post('browser', ['reload', id, '--hard']);
        await post('browser', ['reload', id]);
        expect(driven.map((call) => call.action)).toEqual([
            { kind: 'reload', ignoreCache: true },
            { kind: 'reload', ignoreCache: false }
        ]);
    });

    test('back, forward and stop are the page words they say they are', async () => {
        const id = await ownPage();
        await post('browser', ['back', id]);
        await post('browser', ['forward', id]);
        await post('browser', ['stop', id]);
        expect(driven.map((call) => call.action.kind)).toEqual(['back', 'forward', 'stop']);
    });

    test('nobody with the page on screen is an answer and not a failure', async () => {
        const id = await ownPage();
        pageOpen = false;
        const { status, lines } = await post('browser', ['go', id, '--url', 'https://example.com/two']);
        expect(status).toBe(200);
        expect(lines).toEqual(['open\tno\tNobody has this page open right now, so nothing was driving it']);
    });

    test('a shot answers with the file it wrote, and with nothing when no page is open', async () => {
        const id = await ownPage();
        const { lines } = await post('browser', ['shot', id]);
        expect(lines[1]).toBe(`shot\t${shotPath}\tRead it with your own tools`);
        expect(lines[2]).toBe(`page\t${id}\thttps://example.com/two\tTwo`);
        pageOpen = false;
        expect((await post('browser', ['shot', id])).lines).toEqual(['open\tno\tNobody has this page open right now, so there was nothing to photograph']);
    });

    test('a page no line runs to is refused, and the pages that do run to one are listed', async () => {
        const stranger = (await post('node', ['new', 'browser', '--url', 'https://example.com/far', '--view', 'board'])).lines[0]!.split('\t')[0]!;
        const mine = await ownPage();
        const { status, lines } = await post('browser', ['state', stranger]);
        expect(status).toBe(422);
        expect(lines[0]).toBe(`refused\tnot-linked\tNo line runs between you and ${stranger}, and that line is what lets you drive its page`);
        expect(lines.some((line) => line.startsWith(`browser\t${mine}\t`))).toBe(true);
        // Where a page stands is read for the hint, and nothing is driven anywhere.
        expect(driven.filter((call) => call.action.kind !== 'state')).toEqual([]);
    });

    test('a refusal names the address a page is at, and the stored one only when nobody holds it', async () => {
        const mine = await ownPage();
        const far = (await post('node', ['new', 'browser', '--url', 'https://example.com/far', '--view', 'board'])).lines[0]!.split('\t')[0]!;
        const open = (await post('browser', ['state', far])).lines;
        expect(open).toContain(
            'see\truimte-context node new browser --url https://example.com/two\topens a page of your own on your canvas, with the line to it drawn'
        );
        expect(open.find((line) => line.startsWith(`browser\t${mine}\t`))?.split('\t')[3]).toBe('https://example.com/two');

        pageOpen = false;
        const closed = (await post('browser', ['state', far])).lines;
        expect(closed).toContain(
            'see\truimte-context node new browser --url https://example.com/far\topens a page of your own on your canvas, with the line to it drawn'
        );
        expect(closed.find((line) => line.startsWith(`browser\t${mine}\t`))?.split('\t')[3]).toBe('https://example.com/');
    });

    test('a line is the hint only for a page on the canvas of the caller', async () => {
        pageOpen = false;
        const near = (
            await post('node', ['new', 'browser', '--url', 'https://example.com/near', '--view', 'main', '--beside', 'note-1'], 'chat')
        ).lines[0]!.split('\t')[0]!;
        expect((await post('browser', ['state', near])).lines[1]).toBe(`see\truimte-context link new --to ${near}\tdraws it`);

        const far = (await post('node', ['new', 'browser', '--url', 'https://example.com/far', '--view', 'board'])).lines[0]!.split('\t')[0]!;
        const across = (await post('browser', ['state', far])).lines;
        expect(across.slice(1, 3)).toEqual([
            `note\t${far} stands on board and you on main, and a line only runs between two nodes of one canvas`,
            'see\truimte-context node new browser --url https://example.com/far\topens a page of your own on your canvas, with the line to it drawn'
        ]);
        expect(across.some((line) => line.includes(`link new --to ${far}`))).toBe(false);

        const alone = (await post('browser', ['state', far], 'chat')).lines;
        expect(alone[1]).toBe(
            `note\t${far} stands on board, and you are a view of your own: a line only runs between two nodes of one canvas, so no page can be linked to you`
        );
        expect(alone.some((line) => line.includes('link new'))).toBe(false);
    });

    test('a node that is not a browser, and an id that is no node at all, are refused by name', async () => {
        expect((await post('browser', ['state', 'note-1'])).lines[0]).toBe(
            'refused\tnot-a-browser\tnote-1 is a note node, and only a browser node has a page to drive'
        );
        expect((await post('browser', ['state', 'nowhere'])).lines[0]).toBe('refused\tunknown-node\tnowhere is not a node of this project');
    });

    test('go takes an http or https address and nothing else', async () => {
        const id = await ownPage();
        expect((await post('browser', ['go', id, '--url', 'ftp://example.com'])).lines[0]).toContain('refused\tbad-url');
        expect(driven).toEqual([]);
    });
});
