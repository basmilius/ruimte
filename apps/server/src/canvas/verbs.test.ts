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
    GROUP_HEADER,
    GROUP_PADDING,
    NODE_ACCENT_NAMES,
    NODE_SIZE,
    PROJECT_ICON_NAMES,
    type AgentKind,
    type ProjectCanvasView,
    type ProjectContent,
    type ProjectDocument,
    type ProjectNode,
    type ProjectView,
    type RuntimeMode,
    type Worktree
} from '@ruimte/contracts';
import { SESSION_VARIABLES } from '../config.ts';
import { MAX_SCREEN_LINES } from '../context/context-store.ts';
import { documentPathInFolder } from '../projects/project-files.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { DiagramStore } from '../projects/diagram-store.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { AgentLineageStore } from '../agents/lineage.ts';
import { DIAGRAM_EXAMPLE } from './diagram-verb.ts';
import { MAX_PROMPT_LENGTH } from '../agents/pending-prompts.ts';
import { CANVAS_PATH, handleCanvasRequest } from './canvas-route.ts';
import { MAX_AGENT_DEPTH, MAX_OPENED_PER_CALLER, MAX_TEAM_DEPTH } from './depth.ts';
import { AGENT_KINDS, NEW_NODE } from './agent-verb.ts';
import { MAX_LINKS } from './link-verb.ts';
import { MAX_CANVAS_NODES } from './node-verb.ts';
import { PLACEMENT_GAP, TEAM_COLUMNS } from './placement.ts';
import { MAX_ROLES, ROLES_SHAPE } from './team-verb.ts';
import { MAX_PROJECT_VIEWS, VIEW_KINDS, viewVerb } from './view-verb.ts';
import { MAX_NOTICE_LENGTH } from '../context/notices.ts';
import type { Notice, NoticeDelivery } from '../context/notices.ts';
import { MAX_TITLE_LENGTH, type AgentStart, type CanvasHost } from './verb.ts';
import { VERBS } from './verbs.ts';
import { TaskStore } from '../tasks/task-store.ts';
import { MAX_TASK_PROMPT_LENGTH, nextLine, taskBrief } from './task-verbs.ts';

const VIEW_SUBS = viewVerb.subcommands ?? [];

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
    madeWorktrees = [];
    removedWorktrees = [];
    breakWrites = false;
    installed = ['claude', 'codex', 'gemini', 'copilot'];
    held = [];
    started = [];
    deleteAnyView = false;
    ended = [];
    watching = [];
    notified = [];
    delivery = { at: 'waiting', detail: 'nothing runs in that node yet; it reads the message when it starts (1 waiting)' };
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
    mutate: (id, apply) =>
        store.mutate(id, async (current) => {
            const mutation = await apply(current);
            return breakWrites && mutation.content ? { ...mutation, content: withRepeatedId(mutation.content) } : mutation;
        }),
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
        done: async (childId, text) => {
            const open = tasks.openFor(childId);
            return open ? tasks.settle(open.id, 'done', { text, source: 'done', at: 2 }, 2) : null;
        },
        involving: (nodeId) => tasks.involving(nodeId)
    },
    plans: { read: async () => [], create: unusedPlans, apply: unusedPlans, delete: unusedPlans }
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

const onDisk = async (): Promise<ProjectDocument> => JSON.parse(await readFile(documentPathInFolder(folder), 'utf8'));

const canvasOnDisk = async (id = 'main'): Promise<ProjectCanvasView> => (await onDisk()).views.find((view) => view.id === id) as ProjectCanvasView;

const CANVAS_LINES = ['canvas\tmain\tCanvas', 'canvas\tboard\tBoard'];

/* A view the caller made itself, which is the only kind `view delete` takes away by default. */
const made = async (name: string, argv: string[] = [], token = 'term'): Promise<string> =>
    (await post('view', ['new', name, ...argv], token)).lines[0]!.split('\t')[0]!;

/* The last column of `views`, per view id: whether `view delete` would remove it for this caller. */
const deleteColumn = async (token = 'term'): Promise<Record<string, string>> =>
    Object.fromEntries(
        (await post('views', [], token)).lines
            .filter((line) => !line.startsWith('self\t'))
            .map((line) => line.split('\t'))
            .map(([id, , , may]) => [id!, may!])
    );

/* The reason column beside it, which is what makes a yes or a no read as more than an opinion. */
const deleteWhy = async (token = 'term'): Promise<Record<string, string>> =>
    Object.fromEntries(
        (await post('views', [], token)).lines
            .filter((line) => !line.startsWith('self\t'))
            .map((line) => line.split('\t'))
            .map(([id, , , , why]) => [id!, why!])
    );

const viewOnDisk = async (id: string): Promise<ProjectView | undefined> => (await onDisk()).views.find((view) => view.id === id);

describe('the route', () => {
    test('answers 405 to anything but POST and 401 to an unknown token', async () => {
        const path = `${CANVAS_PATH}/help`;
        const deps = { targetForToken: () => null, host: host() };
        expect((await handleCanvasRequest(new Request(`http://127.0.0.1${path}`), path, deps)).status).toBe(405);
        expect((await post('help', [], 'nope')).status).toBe(401);
    });

    test('an unknown verb is a 404 refusal that lists the verbs', async () => {
        const { status, lines } = await post('spawn', ['claude']);
        expect(status).toBe(404);
        expect(lines[0]).toBe('refused\tunknown-verb\tspawn is not a verb');
        expect(lines.slice(1)).toEqual(VERBS.map((verb) => `verb\t${verb.name}\t${verb.usage}\t${verb.summary}`));
    });

    test('a verb and its arguments quoted into one name is told what went wrong', async () => {
        const { status, lines } = await post('help agent', []);
        expect(status).toBe(404);
        expect(lines[0]).toBe('refused\tunknown-verb\thelp agent is not a verb');
        expect(lines[1]).toBe('note\tA verb and its arguments are separate words, so this is ruimte-context help agent, not one name');
        expect(lines.slice(2)).toEqual(VERBS.map((verb) => `verb\t${verb.name}\t${verb.usage}\t${verb.summary}`));
        // A name that starts with nothing this daemon knows gets the list and no guess.
        expect((await post('spawn team', [])).lines[1]).toStartWith('verb\t');
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

describe('help', () => {
    test('renders one row per verb from the registry, with what is not a verb marked as such', async () => {
        const { status, lines } = await post('help', []);
        expect(status).toBe(200);
        expect(lines.slice(0, -5)).toEqual(VERBS.map((verb) => `verb\t${verb.name}\t${verb.usage}\t${verb.summary}`));
        expect(lines.map((line) => line.split('\t')[0])).toEqual([...VERBS.map(() => 'verb'), 'scope', 'ids', 'dry run', 'detail', 'refusal']);
        expect(lines[2]).toBe('verb\tread\t<id> [--tail N] [--subagent T]\tPrints one linked source, whole or its last N lines');
        expect(lines.at(-5)).toStartWith('scope\tlist and read are what a person linked into this session;');
        expect(lines.at(-4)).toBe('ids\tIds in this output are for your commands. When you talk to the person, name things by their title, never by id');
        expect(lines.at(-3)).toBe('dry run\t--dry-run\tnode, agent, team\tsame checks, nothing made; every other verb refuses the flag');
        expect(lines.at(-2)).toBe('detail\truimte-context help <verb>\tone verb in full');
        expect(lines.at(-1)).toBe(
            'refusal\trefused<TAB><code><TAB><message> on stderr, then what you can pick instead\texit 0 done, 1 the daemon failed, 2 not in a live Ruimte session, 3 refused'
        );
    });

    test('help <verb> details one verb, synopsis first and refusals last', async () => {
        for (const verb of VERBS) {
            const { status, lines } = await post('help', [verb.name]);
            expect(status).toBe(200);
            expect(lines[0]).toBe(`usage\t${verb.name}\t${verb.usage}`);
            expect(lines[1]).toBe(`about\t${verb.summary}`);
            const subs = verb.served === 'canvas' ? (verb.subcommands ?? []) : [];
            expect(lines.slice(2, -1)).toEqual([
                ...verb.detail,
                ...subs.flatMap((sub) => [`usage\t${sub.name}\t${sub.usage}`, `about\t${sub.name}\t${sub.summary}`, ...sub.detail])
            ]);
            expect(lines.at(-1)).toStartWith('refusal\t');
            // Tab-separated rows, never a paragraph.
            expect(lines.every((line) => line.includes('\t'))).toBe(true);
        }
    });

    test('every flag a verb takes is a line of its own detail', async () => {
        for (const verb of VERBS) {
            if (verb.served !== 'canvas') {
                continue;
            }
            const { lines } = await post('help', [verb.name]);
            for (const flag of verb.flagNames) {
                expect(lines.some((line) => line.startsWith(`flag\t--${flag} `) || line.startsWith(`flag\t--${flag}\t`))).toBe(true);
            }
        }
    });

    test('help node says what it prints, which flag goes with which kind, and where a node lands', async () => {
        const { lines } = await post('help', ['node']);
        expect(lines).toContain('prints\tid\tkind\tview\tthe id of the new node, its kind, and the canvas it landed on');
        expect(lines).toContain('kind\tnote\t--text\tcalled "Note" without --title');
        expect(lines).toContain('kind\tbrowser\t--url (required)\tcalled "Browser" without --title');
        expect(lines).toContain('kind\tevery kind\t--title T, --view V, --beside N');
        expect(lines).toContain('flag\t--url U\tbrowser (required)\tAn http or https address');
        expect(lines).toContain('flag\t--cwd P\tterminal, chat\tThe directory the shell starts in');
        expect(lines).toContain('kind\tdiagram\t--source (required)\tcalled the name of the diagram view without --title');
        expect(lines.filter((line) => line.startsWith('where\t')).length).toBe(2);
        expect(lines.filter((line) => line.startsWith('paths\t')).length).toBe(2);
        expect(lines.some((line) => line.includes('--text - takes the body from stdin'))).toBe(true);
    });

    test('help agent covers what a first-time caller cannot see from the canvas', async () => {
        const { lines } = await post('help', ['agent']);
        expect(lines).toContain(
            'prints\tid\tkind\tview\tcli\tedge\ttask\tthe new node, its kind (terminal or chat), the canvas it landed on, the CLI it runs, the id of the edge drawn into it (- when none was drawn) and, with --task, the id of the task'
        );
        // Which CLIs take --chat, from the registry rather than from a sentence that can drift.
        expect(lines.some((line) => line.startsWith('flag\t--chat\t') && line.includes('claude, codex'))).toBe(true);
        expect(lines.some((line) => line.startsWith('flag\t--prompt T\t') && line.includes(String(MAX_PROMPT_LENGTH)))).toBe(true);
        expect(lines.some((line) => line.startsWith('paths\t') && line.includes('worktree'))).toBe(true);
        expect(lines.some((line) => line.startsWith('without a prompt\t'))).toBe(true);
        expect(lines.some((line) => line.startsWith('edge\t') && line.includes('One way only') && line.includes('ruimte-context link'))).toBe(true);
        expect(lines.some((line) => line.startsWith('groups\t') && line.includes('ruimte-context nodes'))).toBe(true);
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
        expect(lines.some((line) => line.startsWith('edges\t') && line.includes('ruimte-context link --to'))).toBe(true);
        // Which CLIs take a chat role, from the registry rather than from a phrase that can drift.
        expect(lines.some((line) => line.startsWith('roles\tchat\t') && line.includes('(claude, codex)'))).toBe(true);
        expect(lines.some((line) => line.startsWith('depth\t') && line.includes(`A role lands at depth ${MAX_TEAM_DEPTH}`) && line.includes('agent'))).toBe(
            true
        );
        expect(lines.some((line) => line.startsWith('flag\t--label L\t') && line.includes(String(MAX_TITLE_LENGTH)))).toBe(true);
        expect(lines.some((line) => line.startsWith('roles\ttitle\t') && line.includes(String(MAX_TITLE_LENGTH)))).toBe(true);
        expect(lines.some((line) => line.startsWith('titles\t') && line.includes('never unique'))).toBe(true);
        expect(lines.some((line) => line.startsWith('quoting\t') && line.includes("'\\''") && line.includes('\\u0027'))).toBe(true);
        expect(lines.some((line) => line.startsWith('flag\t--dry-run\t') && line.includes("<from> -> <the role's title>"))).toBe(true);
    });

    test('help link says what its label may be', async () => {
        const { lines } = await post('help', ['link']);
        expect(lines.some((line) => line.startsWith('flag\t--label L\t') && line.includes(String(MAX_TITLE_LENGTH)))).toBe(true);
    });

    test('every verb that draws or lists a line points at edges', async () => {
        for (const verb of ['agent', 'team', 'link', 'nodes']) {
            const { lines } = await post('help', [verb]);
            expect(lines.some((line) => line.includes('ruimte-context edges'))).toBe(true);
        }
        const { lines } = await post('help', ['team']);
        expect(lines.some((line) => line.startsWith('edges\t') && line.includes('One way only'))).toBe(true);
        expect(lines.some((line) => line.startsWith('example\t') && line.includes('--roles'))).toBe(true);
    });

    test('the verbs about linked context and the verbs about the canvas are told apart wherever they meet', async () => {
        for (const verb of ['list', 'read', 'nodes']) {
            const scope = (await post('help', [verb])).lines.filter((line) => line.startsWith('scope\t'));
            expect(scope).toHaveLength(1);
            expect(scope[0]).toInclude('a node you add is readable through read only once a line runs from it into you');
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

    test('help nodes says which row the caller is, and names the variable that says it too', async () => {
        const self = (await post('help', ['nodes'])).lines.filter((line) => line.startsWith('self\t'));
        expect(self).toHaveLength(2);
        expect(self[0]).toInclude('self and your own id');
        expect(self[1]).toInclude('$RUIMTE_SESSION_ID');
        expect(SESSION_VARIABLES).toContain('RUIMTE_SESSION_ID');
        // A chat backend is spawned without it, and help must not send one looking for what it never got.
        expect(self[1]).toInclude('a chat backend is given none');
    });

    test('help views says a separator has no name', async () => {
        expect((await post('help', ['views'])).lines).toContain('note\tA separator is a line in the sidebar and has an empty name');
    });

    test('a verb it does not have is refused with the list', async () => {
        const { status, lines } = await post('help', ['spawn']);
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tunknown-verb\tspawn is not a verb');
        expect(lines.slice(1)).toEqual(VERBS.map((verb) => `verb\t${verb.name}\t${verb.usage}\t${verb.summary}`));
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
        const extra = await post('help', ['nodes', 'node']);
        expect(extra.lines).toEqual([
            'refused\tbad-arguments\thelp takes one verb name and nothing else',
            'usage\thelp\t[verb]',
            'detail\truimte-context help help'
        ]);
    });
});

describe('refusals', () => {
    test('say what is missing and, for a closed set, what may go there', async () => {
        const cases: Array<{ verb: string; argv: string[]; code: string; message: string }> = [
            { verb: 'node', argv: [], code: 'bad-arguments', message: 'node needs a kind: note, browser, drawing, diagram, file, terminal, chat' },
            { verb: 'node', argv: ['group'], code: 'bad-arguments', message: 'node needs a kind: note, browser, drawing, diagram, file, terminal, chat' },
            { verb: 'node', argv: ['note', 'My note'], code: 'bad-arguments', message: 'node takes one kind and nothing else; a title goes in --title' },
            { verb: 'node', argv: ['note', '--title='], code: 'bad-arguments', message: '--title needs a title' },
            { verb: 'node', argv: ['note', '--view='], code: 'bad-arguments', message: '--view needs the id of a canvas' },
            { verb: 'node', argv: ['note', '--beside='], code: 'bad-arguments', message: '--beside needs the id of a node on that canvas' },
            { verb: 'nodes', argv: ['main'], code: 'bad-arguments', message: 'nodes takes no arguments, only flags' },
            { verb: 'views', argv: ['all'], code: 'bad-arguments', message: 'views takes no arguments' },
            {
                verb: 'node',
                argv: ['note', '--cmd', 'ls'],
                code: 'unknown-flag',
                message: '--cmd is not one of --title, --text, --url, --path, --source, --cwd, --view, --beside, --dry-run'
            },
            { verb: 'views', argv: ['--view', 'main'], code: 'unknown-flag', message: '--view is not a flag here; this verb takes none' },
            {
                verb: 'node',
                argv: ['note', '--text'],
                code: 'missing-value',
                message: '--text needs a value (write --text=<value> for one that starts with --)'
            },
            { verb: 'node', argv: ['note', '--title', 'a', '--title', 'b'], code: 'duplicate-flag', message: '--title is given twice' }
        ];
        for (const { verb, argv, code, message } of cases) {
            const { status, lines } = await post(verb, argv);
            expect({ argv, status, line: lines[0] }).toEqual({ argv, status: 422, line: `refused\t${code}\t${message}` });
            expect(lines).toContain(`detail\truimte-context help ${verb}`);
        }
    });

    test('name what can be picked instead wherever the set is closed', async () => {
        const missing = await post('node', ['browser']);
        expect(missing.lines).toEqual([
            'refused\tmissing-flag\tA browser node needs --url',
            'kind\tbrowser\t--url (required)\tcalled "Browser" without --title',
            'kind\tevery kind\t--title T, --view V, --beside N'
        ]);
        expect((await post('node', ['note', '--url', 'https://example.com'])).lines.slice(1)).toEqual([
            'kind\tnote\t--text\tcalled "Note" without --title',
            'kind\tevery kind\t--title T, --view V, --beside N'
        ]);
        expect((await post('node', ['note', '--beside', 'nope'])).lines).toEqual([
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
        expect((await post('node', ['note', '--view', 'board', '--beside', 'nope'])).lines).toEqual([
            'refused\tunknown-node\tnope is not a node on board',
            'detail\truimte-context nodes\tthe 30 nodes of board'
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
            const { lines } = await post('node', argv);
            expect(lines[0]).toStartWith(`refused\t${code}\t`);
            expect(lines[0]).toInclude(says);
            // Nothing is invented: a path or an address has no list to pick from.
            expect(lines).toHaveLength(1);
        }
    });

    test('never leak a message out of zod', async () => {
        const argvPerVerb: Record<string, string[][]> = {
            help: [['nope', 'nope']],
            nodes: [['x'], ['--view=']],
            views: [['x']],
            node: [[], ['x'], ['note', 'x'], ['note', '--path=']]
        };
        for (const [verb, cases] of Object.entries(argvPerVerb)) {
            for (const argv of cases) {
                const message = (await post(verb, argv)).lines[0]!.split('\t')[2]!;
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

        const noNodes = await post('node', ['note', '--text', 'x', '--view', 'board', '--beside', 'ghost']);
        expect(noNodes.lines).toEqual(['refused\tunknown-node\tghost is not a node on board', 'note\tboard has no nodes on it yet']);

        const empty = content();
        empty.views = [{ kind: 'chat', id: 'chat-1', name: 'Planner', node: {} }];
        await store.mutate(projectId, () => ({ content: empty, result: null }));
        const noCanvas = await post('node', ['note', '--text', 'x'], 'chat');
        expect(noCanvas.lines).toEqual([
            'refused\tview-required\tThis session is not on a canvas; name one with --view',
            'note\tThis project has no canvas; a node only ever lands on one'
        ]);
    });

    test('a --source with no drawing view in the project says that too', async () => {
        const noDrawings = content();
        noDrawings.views = noDrawings.views.filter((view) => view.kind !== 'drawing');
        await store.mutate(projectId, () => ({ content: noDrawings, result: null }));
        const { lines } = await post('node', ['drawing', '--source', 'nowhere']);
        expect(lines).toEqual([
            'refused\tnot-a-drawing\tnowhere is not a drawing view of this project',
            'note\tThis project has no drawing views; a person makes one in the sidebar'
        ]);
    });
});

describe('scoping', () => {
    test('a caller no project places is refused', async () => {
        expect((await post('views', [], 'stray')).lines).toEqual([
            'refused\tnot-in-project\tThis session is not a node or a view of any project on this machine'
        ]);
    });

    test('a node on a canvas works on that canvas by default', async () => {
        const { status, lines } = await post('nodes', []);
        expect(status).toBe(200);
        expect(lines).toEqual(['term-1\tterminal\tshell\t0\t0\t560\t360\t', 'note-1\tnote\tPlan with a tab\t0\t601\t320\t240\t', 'self\tterm-1']);
    });

    test('--view picks another canvas, where the caller is nobody', async () => {
        expect(await post('nodes', ['--view', 'board'])).toEqual({ status: 200, lines: ['self\t-\tyou are not a node on this canvas'] });
    });

    test('a chat that is a view of its own needs --view, and hears which canvases there are', async () => {
        const { status, lines } = await post('nodes', [], 'chat');
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tview-required\t');
        expect(lines.slice(1)).toEqual(CANVAS_LINES);
        expect((await post('node', ['note'], 'chat')).lines[0]).toStartWith('refused\tview-required\t');
        expect((await post('node', ['note', '--view', 'board'], 'chat')).status).toBe(200);
    });

    test('a --view that is not a canvas is refused with the canvases listed', async () => {
        for (const view of ['chat-1', 'sketch-1', 'missing']) {
            const { status, lines } = await post('nodes', ['--view', view]);
            expect(status).toBe(422);
            expect(lines[0]).toStartWith('refused\tnot-a-canvas\t');
            expect(lines.slice(1)).toEqual(CANVAS_LINES);
        }
    });
});

describe('views', () => {
    test('lists every view in sidebar order, a separator with an empty name', async () => {
        expect((await post('views', [])).lines).toEqual([
            'main\tcanvas\tCanvas\tno\tyou are in it',
            'sep-1\tseparator\t\tno\ta person made it',
            'board\tcanvas\tBoard\tno\ta person made it',
            'chat-1\tchat\tPlanner\tno\ta person made it',
            'sketch-1\tdrawing\tSketch\tno\ta person made it',
            // The last row is the view the caller stands in, which it can read nowhere else.
            'self\tmain'
        ]);
        expect((await post('views', [], 'chat')).lines.at(-1)).toBe('self\tchat-1');
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

describe('edges', () => {
    test('lists the lines of a canvas, id, from, to and label', async () => {
        await post('link', ['--to', 'note-1', '--label', 'plan']);
        await post('link', ['--to', 'note-1', '--from', 'note-1']).catch(() => null);
        const { status, lines } = await post('edges', []);
        expect(status).toBe(200);
        const edges = (await canvasOnDisk()).edges;
        expect(lines).toEqual(edges.map((edge) => [edge.id, edge.from, edge.to, edge.label ?? ''].join('\t')));
        expect(lines[0]!.split('\t').slice(1)).toEqual(['term-1', 'note-1', 'plan']);
    });

    test('a canvas with no lines on it prints nothing, and --view says which canvas', async () => {
        expect((await post('edges', [])).lines).toEqual([]);
        expect((await post('edges', ['--view', 'board'])).lines).toEqual([]);
        expect((await post('edges', ['--view', 'sketch-1'])).lines[0]).toBe('refused\tnot-a-canvas\tsketch-1 is not a canvas of this project');
        expect((await post('edges', ['--view', 'main'], 'chat')).lines).toEqual([]);
        expect((await post('edges', [], 'chat')).lines[0]).toStartWith('refused\tview-required\t');
    });

    test('reads only, so it takes no --dry-run', async () => {
        expect((await post('edges', ['--dry-run'])).lines[0]).toStartWith('refused\tno-dry-run\t');
    });
});

describe('node', () => {
    test('adds a note beside the caller on a released project and prints its id', async () => {
        const { status, lines } = await post('node', ['note', '--text', 'hello']);
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

    test('--beside places right of a named node, and refuses one that is not on the canvas', async () => {
        const { lines } = await post('node', ['terminal', '--beside', 'note-1', '--title', 'Build']);
        const id = lines[0]!.split('\t')[0];
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === id)!;
        expect([node.x, node.y, node.title, node.titleSource]).toEqual([320 + PLACEMENT_GAP, 601, 'Build', 'user']);
        expect((await post('node', ['note', '--beside', 'chat-1'])).lines[0]).toStartWith('refused\tunknown-node\t');
    });

    test('--beside wins over the row beside the caller, wherever the anchor sits', async () => {
        // Far left of everything and well below the caller: the first free spot on the caller's row is nowhere near it.
        const moved = content();
        (moved.views[0] as ProjectCanvasView).nodes[1]!.x = -4000;
        (moved.views[0] as ProjectCanvasView).nodes[1]!.y = 2400;
        await store.mutate(projectId, () => ({ content: moved, result: null }));

        const { lines } = await post('node', ['note', '--beside', 'note-1']);
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === lines[0]!.split('\t')[0])!;
        expect([node.x, node.y]).toEqual([-4000 + 320 + PLACEMENT_GAP, 2400]);
    });

    test('--text reads \\n, \\t and \\\\ and leaves every other backslash alone', async () => {
        const { lines } = await post('node', ['note', '--text', 'Line one\\nLine two\\tend\\\\d\\s']);
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === lines[0]!.split('\t')[0])!;
        expect(node.body).toBe('Line one\nLine two\tend\\d\\s');
    });

    test('needs a kind it knows', async () => {
        expect((await post('node', [])).lines[0]).toStartWith('refused\tbad-arguments\t');
        expect((await post('node', ['group'])).lines[0]).toStartWith('refused\tbad-arguments\t');
        expect((await post('node', ['note', '--cmd', 'ls'])).lines[0]).toStartWith('refused\tunknown-flag\t');
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
            expect((await post('node', argv)).lines[0]).toStartWith('refused\tflag-not-for-kind\t');
        }
    });

    test('a browser needs an http(s) URL', async () => {
        expect((await post('node', ['browser'])).lines[0]).toStartWith('refused\tmissing-flag\t');
        expect((await post('node', ['browser', '--url', 'file:///etc/passwd'])).lines[0]).toStartWith('refused\tbad-url\t');
        expect((await post('node', ['browser', '--url', 'not a url'])).lines[0]).toStartWith('refused\tbad-url\t');
        const { lines } = await post('node', ['browser', '--url', 'https://example.com/docs']);
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === lines[0]!.split('\t')[0])!;
        expect(node.url).toBe('https://example.com/docs');
    });

    test('a file stores its path relative to the folder, and an outside one absolute', async () => {
        expect((await post('node', ['file'])).lines[0]).toStartWith('refused\tmissing-flag\t');
        expect((await post('node', ['file', '--path', 'src/missing.ts'])).lines[0]).toStartWith('refused\tbad-path\t');
        expect((await post('node', ['file', '--path', 'src'])).lines[0]).toStartWith('refused\tbad-path\t');
        const inside = (await post('node', ['file', '--path', 'src/main.ts'])).lines[0]!.split('\t')[0];
        const absolute = (await post('node', ['file', '--path', join(outside, 'notes.md')])).lines[0]!.split('\t')[0];
        const nodes = (await canvasOnDisk()).nodes;
        expect(nodes.find((node) => node.id === inside)).toMatchObject({ path: 'src/main.ts', title: 'main.ts' });
        expect(nodes.find((node) => node.id === absolute)).toMatchObject({ path: join(outside, 'notes.md'), title: 'notes.md' });
    });

    test('a drawing needs a drawing view of the same project as its source', async () => {
        expect((await post('node', ['drawing'])).lines[0]).toStartWith('refused\tmissing-flag\t');
        const wrong = await post('node', ['drawing', '--source', 'board']);
        expect(wrong.lines).toEqual(['refused\tnot-a-drawing\tboard is not a drawing view of this project', 'drawing\tsketch-1\tSketch']);
        const { lines } = await post('node', ['drawing', '--source', 'sketch-1']);
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === lines[0]!.split('\t')[0])!;
        expect(node).toMatchObject({ viewId: 'sketch-1', title: 'Sketch' });
    });

    test('a diagram needs a diagram view of the same project as its source', async () => {
        const withFlow = content();
        withFlow.views.push({ kind: 'diagram', id: 'flow-1', name: 'Flow' });
        await store.mutate(projectId, () => ({ content: withFlow, result: null }));

        expect((await post('node', ['diagram'])).lines[0]).toStartWith('refused\tmissing-flag\t');
        // A drawing is not a diagram, even though both take --source.
        const wrongKind = await post('node', ['diagram', '--source', 'sketch-1']);
        expect(wrongKind.lines).toEqual(['refused\tnot-a-diagram\tsketch-1 is not a diagram view of this project', 'diagram\tflow-1\tFlow']);
        const unknown = await post('node', ['diagram', '--source', 'nowhere']);
        expect(unknown.lines[0]).toBe('refused\tnot-a-diagram\tnowhere is not a diagram view of this project');
        expect((await post('node', ['drawing', '--source', 'flow-1'])).lines[0]).toStartWith('refused\tnot-a-drawing\t');

        const { lines } = await post('node', ['diagram', '--source', 'flow-1']);
        const [id, kind] = lines[0]!.split('\t');
        expect(kind).toBe('diagram');
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === id)!;
        expect(node).toMatchObject({ kind: 'diagram', viewId: 'flow-1', title: 'Flow', w: 480, h: 360 });
    });

    test('a --source with no diagram view in the project says how to make one', async () => {
        const { lines } = await post('node', ['diagram', '--source', 'nowhere']);
        expect(lines).toEqual([
            'refused\tnot-a-diagram\tnowhere is not a diagram view of this project',
            'note\tThis project has no diagram views; ruimte-context view new --kind diagram makes one'
        ]);
    });

    test('a cwd lies inside the folder or a worktree of it', async () => {
        const { lines } = await post('node', ['chat', '--cwd', 'src']);
        expect(lines[0]).not.toStartWith('refused');
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === lines[0]!.split('\t')[0])!;
        // Stored portable, like every cwd the client saves.
        expect(node.cwd).toBe('./src');

        expect((await post('node', ['terminal', '--cwd', outside])).lines[0]).toStartWith('refused\tcwd-outside-project\t');
        expect((await post('node', ['terminal', '--cwd', '../elsewhere'])).lines[0]).toStartWith('refused\tcwd-outside-project\t');
        expect((await post('node', ['terminal', '--cwd', 'nope'])).lines[0]).toStartWith('refused\tbad-cwd\t');

        await symlink(outside, join(folder, 'escape'));
        expect((await post('node', ['terminal', '--cwd', 'escape'])).lines[0]).toStartWith('refused\tcwd-outside-project\t');

        worktrees = [worktree];
        expect((await post('node', ['terminal', '--cwd', worktree])).status).toBe(200);
    });

    test('a cwd outside names the folder and every worktree, so the next try needs no guessing', async () => {
        const bare = await post('node', ['terminal', '--cwd', outside]);
        expect(bare.lines).toEqual([`refused\tcwd-outside-project\t${outside} is outside ${folder} and the worktrees of its repository`, `folder\t${folder}`]);

        // git lists the checkout itself among the worktrees; the folder line already said that one.
        worktrees = [folder, worktree];
        const listed = await post('node', ['terminal', '--cwd', outside]);
        expect(listed.lines).toEqual([listed.lines[0]!, `folder\t${folder}`, `worktree\t${worktree}`]);
    });

    test('a project without a folder refuses --cwd', async () => {
        const opened = await store.openProject({ name: 'loose' });
        const loose: ProjectContent = {
            name: 'loose',
            color: '#000000',
            views: [
                {
                    kind: 'canvas',
                    id: 'loose-main',
                    name: 'Canvas',
                    nodes: [{ id: 'term-2', kind: 'terminal', title: 't', x: 0, y: 0, w: 10, h: 10 }],
                    texts: [],
                    edges: [],
                    layouts: []
                }
            ]
        };
        await store.save(opened.summary.projectId, opened.document.rev, loose);
        TOKENS.loose = 'term-2';
        expect((await post('node', ['terminal', '--cwd', '/tmp'], 'loose')).lines[0]).toStartWith('refused\tno-folder\t');
        expect((await post('node', ['note'], 'loose')).status).toBe(200);
    });

    test('an id is unique across the whole project', async () => {
        const ids = new Set<string>();
        for (let i = 0; i < 20; i++) {
            ids.add((await post('node', ['note'])).lines[0]!.split('\t')[0]!);
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
            ['node', 'note'],
            ['agent', 'claude']
        ]) {
            expect((await post(argv[0]!, [argv[1]!, '--view', 'board'])).lines[0]).toBe(
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

describe('agent', () => {
    test('opens a terminal agent with an edge from the caller into it, and holds the prompt', async () => {
        const { status, lines } = await post('agent', ['claude', '--prompt', 'say hello']);
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

    test('--chat makes a chat node fixed to its CLI', async () => {
        const { lines } = await post('agent', ['codex', '--chat', '--title', 'Reviewer']);
        const [id, kind] = lines[0]!.split('\t');
        expect(kind).toBe('chat');
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === id)!;
        expect([node.provider, node.providerFixed, node.title, node.titleSource]).toEqual(['codex', true, 'Reviewer', 'user']);
        // Without a prompt it is still started: a chat registers and waits, a terminal runs its CLI at its own prompt.
        expect(started).toEqual([{ projectId, nodeId: id!, openedBy: 'term-1', node: 'chat', provider: 'codex', cwd: folder }]);
    });

    test('--chat is refused for a CLI without a chat backend, with the ones that have one', async () => {
        const { status, lines } = await post('agent', ['gemini', '--chat']);
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tno-chat-backend\tGemini has no chat backend; leave --chat out and it opens as a terminal agent');
        expect(lines.slice(1)).toEqual(['cli\tclaude\tClaude Code\ttakes --chat', 'cli\tcodex\tCodex\ttakes --chat']);
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
        expect(lines[0]!.split('\t').slice(1)).toEqual(['terminal', 'board', 'claude', '-']);
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
});

describe('the mode ceiling', () => {
    test("--mode wider than the caller is refused with a code and the caller's mode", async () => {
        modes = { 'chat-1': 'supervised' };
        const { status, lines } = await post('agent', ['claude', '--chat', '--mode', 'full-access', '--view', 'board'], 'chat');
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
        const chat = await post('agent', ['claude', '--chat', '--mode', 'auto-accept-edits']);
        const terminal = await post('agent', ['codex', '--mode', 'auto']);
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
        await post('agent', ['claude']);
        terminalPreference = 'supervised';
        await post('agent', ['claude']);
        await post('agent', ['claude', '--chat']);
        expect(started.map((start) => start.runtimeMode)).toEqual(['auto-accept-edits', 'supervised', undefined]);
        const roles = JSON.stringify([
            { provider: 'claude', title: 'One', prompt: 'a' },
            { provider: 'claude', title: 'Two', prompt: 'b', chat: true }
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
            { provider: 'claude', title: 'Lexer', prompt: 'b', chat: true },
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
        await post('agent', ['claude', '--chat', '--worktree', '--task', 'Fix the lexer', '--prompt', 'go', '--view', 'board'], 'chat');
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
        { title: 'Lexer', prompt: 'fix the tokenizer', provider: 'claude' },
        { title: 'Parser', prompt: 'fix the parser', provider: 'codex', chat: true },
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
            [[THREE[0], { title: 'Parser', prompt: 'go', provider: 'codex', chat: 'yes' }], 'role 1 (chat): chat is true or false'],
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

    test('a role asking for a chat on a CLI without one, or for a CLI that is not here, is refused by index', async () => {
        const noChat = await post('team', args([THREE[0], { title: 'Docs', prompt: 'go', provider: 'gemini', chat: true }]));
        expect(noChat.lines[0]).toBe('refused\tno-chat-backend\trole 1 (gemini): Gemini has no chat backend; leave chat out and it opens as a terminal agent');
        expect(noChat.lines.slice(1)).toEqual(['cli\tclaude\tClaude Code\ttakes chat', 'cli\tcodex\tCodex\ttakes chat']);

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
            expect(refused.lines[0]).toBe(
                'refused\tview-required\tYou are not a node on a canvas; name the canvas with --view, and what you open lands there without an edge from you, so the edge column shows -'
            );
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
            'dry-run\tterminal\tLexer\tmain\tclaude\tterm-1 -> <Lexer>',
            'dry-run\tterminal\tReviewer\tmain\tclaude\tterm-1 -> <Reviewer>'
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
            const argv = verb === 'node' ? ['note'] : ['claude'];
            expect((await post(verb, [...argv, '--title', long])).lines[0]).toBe(
                `refused\tbad-arguments\t--title is ${MAX_TITLE_LENGTH + 1} characters and at most ${MAX_TITLE_LENGTH} fit in a name on the canvas`
            );
        }
        expect((await post('link', ['--to', 'note-1', '--label', long])).lines[0]).toStartWith(
            `refused\tbad-arguments\t--label is ${MAX_TITLE_LENGTH + 1} characters`
        );
        // A name of exactly the cap is a name, not a refusal.
        expect((await post('node', ['note', '--title', 'L'.repeat(MAX_TITLE_LENGTH)])).status).toBe(200);
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

describe('link', () => {
    test('draws a line from the caller into a node and prints what it made', async () => {
        const { status, lines } = await post('link', ['--to', 'note-1']);
        expect(status).toBe(200);
        const [id, from, to, state, way] = lines[0]!.split('\t');
        expect([from, to, state, way]).toEqual(['term-1', 'note-1', 'new', 'out']);
        expect((await canvasOnDisk()).edges).toEqual([{ id: id!, from: 'term-1', to: 'note-1' }]);
    });

    test('between two agents it draws both ways and labels them context', async () => {
        const pair = content();
        (pair.views[0] as ProjectCanvasView).nodes.push({ id: 'term-2', kind: 'terminal', title: 'other', x: 2000, y: 0, w: 560, h: 360 });
        await store.mutate(projectId, () => ({ content: pair, result: null }));

        const { lines } = await post('link', ['--to', 'term-2']);
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
        await post('link', ['--to', 'note-1']);
        const rev = (await onDisk()).rev;
        const { lines } = await post('link', ['--to', 'note-1']);
        expect(lines[0]!.split('\t')[3]).toBe('existing');
        expect((await onDisk()).rev).toBe(rev);
    });

    test('refuses ids that are not on the canvas and a line to itself', async () => {
        const missing = await post('link', ['--to', 'note-1,ghost,other']);
        expect(missing.lines[0]).toBe('refused\tunknown-node\tghost, other are not a node on main');
        // Never the node the line starts from: --to itself is refused as a self-link.
        expect(missing.lines.slice(1)).toEqual(['node\tnote-1\tnote\tPlan with a tab']);
        expect((await post('link', ['--to', 'term-1'])).lines[0]).toStartWith('refused\tself-link\t');
        expect((await post('link', ['--to', 'note-1', '--view', 'main'], 'chat')).lines[0]).toStartWith(
            'refused\tunknown-node\tYou are not a node on main, so a line has nowhere to start'
        );
        expect((await onDisk()).rev).toBe(1);
    });

    test('--from, --label and --view say where the line goes and what it is called', async () => {
        const { lines } = await post('link', ['--to', 'term-1', '--from', 'note-1', '--label', 'plan']);
        expect(lines[0]!.split('\t').slice(1)).toEqual(['note-1', 'term-1', 'new', 'out']);
        expect((await canvasOnDisk()).edges[0]!.label).toBe('plan');
    });

    test('refuses more than the cap and an empty id', async () => {
        const many = Array.from({ length: MAX_LINKS + 1 }, (_, i) => `n-${i}`).join(',');
        expect((await post('link', ['--to', many])).lines[0]).toStartWith('refused\ttoo-many-links\t');
        expect((await post('link', ['--to', 'note-1,'])).lines[0]).toStartWith('refused\tbad-arguments\t');
    });
});

describe('--dry-run', () => {
    test('agent checks everything, prints what it would make and writes nothing', async () => {
        const { status, lines } = await post('agent', ['claude', '--prompt', 'hi', '--dry-run']);
        expect(status).toBe(200);
        expect(lines).toEqual([`dry-run\tterminal\tmain\tclaude\tterm-1 -> ${NEW_NODE}`]);
        expect((await onDisk()).rev).toBe(1);
        expect(held).toEqual([]);
    });

    test('a dry run still refuses what a real one would', async () => {
        installed = ['codex'];
        expect((await post('agent', ['claude', '--dry-run'])).lines[0]).toStartWith('refused\tcli-not-installed\t');
        installed = ['claude'];
        expect((await post('agent', ['claude', '--group', 'note-1', '--dry-run'])).lines[0]).toStartWith('refused\tunknown-group\t');
    });

    test('node says which kind it would have made', async () => {
        expect((await post('node', ['note', '--text', 'x', '--dry-run'])).lines).toEqual(['dry-run\tnote\tmain']);
        expect((await onDisk()).rev).toBe(1);
    });

    test('a verb that makes nothing refuses the flag and names the ones that take it', async () => {
        const { status, lines } = await post('nodes', ['--dry-run']);
        expect(status).toBe(422);
        expect(lines).toEqual([
            'refused\tno-dry-run\tnodes takes no --dry-run; only the verbs that make something do',
            'verb\tnode\ttakes --dry-run',
            'verb\tagent\ttakes --dry-run',
            'verb\tteam\ttakes --dry-run'
        ]);
        expect((await post('link', ['--to', 'note-1', '--dry-run'])).lines[0]).toStartWith('refused\tno-dry-run\t');
    });
});

describe('view new', () => {
    test('a view and a node of a kind this daemon does not know stay in the file, exactly as they were', async () => {
        const hologram = { kind: 'hologram', id: 'holo', title: 'Hologram', x: 900, y: 0, w: 480, h: 360, beam: { lumens: [1, 2] } };
        const timeline = { name: 'Flow', kind: 'timeline', id: 'timeline-1', tracks: [{ at: 0 }] };
        const file = await onDisk();
        const main = file.views[0] as ProjectCanvasView;
        const views = [{ ...main, nodes: [...main.nodes, hologram] }, timeline, ...file.views.slice(1)];
        await writeFile(documentPathInFolder(folder), JSON.stringify({ ...file, views }, null, 2));

        expect((await post('view', ['new', 'Plan'])).status).toBe(200);

        const after = await onDisk();
        const raw = after.views as unknown as Array<{ id: string; nodes?: Array<{ id: string }> }>;
        expect(JSON.stringify(raw.find((view) => view.id === 'timeline-1'))).toBe(JSON.stringify(timeline));
        expect(JSON.stringify(raw[0]!.nodes!.find((node) => node.id === 'holo'))).toBe(JSON.stringify(hologram));
        expect(after.views.at(-1)).toMatchObject({ kind: 'canvas', name: 'Plan' });
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
    test('takes a Lucide name from the closed set and an emoji', async () => {
        expect((await post('view', ['icon', 'board', 'rocket'])).lines).toEqual(['board\tcanvas\tlucide\trocket']);
        expect(await viewOnDisk('board')).toMatchObject({ icon: { kind: 'lucide', value: 'rocket' } });
        expect((await post('view', ['icon', 'board', '\u{1f680}'])).lines).toEqual(['board\tcanvas\temoji\t\u{1f680}']);
        expect(await viewOnDisk('board')).toMatchObject({ icon: { kind: 'emoji', value: '\u{1f680}' } });
    });

    test('a name that is not one of them is a typo, not an emoji, so it is refused with the set', async () => {
        const { status, lines } = await post('view', ['icon', 'board', 'rockett']);
        expect(status).toBe(422);
        expect(lines[0]).toBe(`refused\tunknown-icon\trockett is not one of the ${PROJECT_ICON_NAMES.length} Lucide names a view picks from`);
        expect(lines.slice(1).every((line) => line.startsWith('icons\t'))).toBe(true);
        expect(lines.slice(1).flatMap((line) => line.split('\t').slice(1))).toEqual([...PROJECT_ICON_NAMES]);
    });

    test('a separator is a line in the sidebar with no room for a mark', async () => {
        expect((await post('view', ['icon', 'sep-1', 'rocket'])).lines[0]).toBe(
            'refused\tnot-markable\tsep-1 is a separator, a line in the sidebar with no room for a mark'
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
        const shell = (await post('node', ['terminal', '--view', id])).lines[0]!.split('\t')[0]!;
        const chat = (await post('node', ['chat', '--view', id])).lines[0]!.split('\t')[0]!;
        await post('node', ['note', '--text', 'x', '--view', id]);

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
        expect(lines[0]).toBe('refused\tunknown-subcommand\tview needs one of new, rename, icon, move, delete');
        expect(lines.slice(1)).toEqual(VIEW_SUBS.map((sub) => `usage\t${sub.name}\t${sub.usage}`));
        expect((await post('view', ['duplicate', 'board'])).lines[0]).toBe(
            'refused\tunknown-subcommand\tview needs one of new, rename, icon, move, delete, and duplicate is not one'
        );
    });

    test('help view prints every one of them in full, out of the registry', async () => {
        const { lines } = await post('help', ['view']);
        for (const sub of VIEW_SUBS) {
            expect(lines).toContain(`usage\t${sub.name}\t${sub.usage}`);
            expect(lines).toContain(`about\t${sub.name}\t${sub.summary}`);
        }
    });

    test('a session that is in no project of this machine changes nothing', async () => {
        expect((await post('view', ['new', 'Plan'], 'stray')).lines[0]).toStartWith('refused\tnot-in-project\t');
        expect((await post('view', ['delete', 'board'], 'stray')).lines[0]).toStartWith('refused\tnot-in-project\t');
    });
});

describe('open', () => {
    /* What open itself would take: the separator is left out, since open refuses it a line later. */
    const VIEW_LINES = ['view\tmain\tcanvas\tCanvas', 'view\tboard\tcanvas\tBoard', 'view\tchat-1\tchat\tPlanner', 'view\tsketch-1\tdrawing\tSketch'];

    test('tells the clients that have the project on screen, and writes nothing', async () => {
        await store.openProject({ projectId });
        store.addViewer('client-1', projectId);
        const { status, lines } = await post('open', ['board']);
        expect(status).toBe(200);
        expect(lines).toEqual(['showing\tboard\tcanvas\tBoard', 'sent\tyes\tEveryone with this project on screen was told']);
        expect(watching).toEqual([{ projectId, viewId: 'board', by: 'term-1' }]);
        // Showing is personal, so the shared file stands where the last write left it.
        expect((await onDisk()).rev).toBe(1);
    });

    test('a project nobody has on screen is not a failure, and the client is not told', async () => {
        const { status, lines } = await post('open', ['sketch-1']);
        expect(status).toBe(200);
        expect(lines).toEqual(['showing\tsketch-1\tdrawing\tSketch', 'sent\tno\tNobody has this project on screen right now, so nothing was showing it']);
        expect(watching).toEqual([]);
    });

    test('a client that let the project go stops being told', async () => {
        store.addViewer('client-1', projectId);
        expect((await post('open', ['board'])).lines[1]).toStartWith('sent\tyes\t');
        store.removeViewer('client-1', projectId);
        expect((await post('open', ['board'])).lines[1]).toStartWith('sent\tno\t');
        expect(watching).toHaveLength(1);
    });

    test('a separator never opens', async () => {
        const { status, lines } = await post('open', ['sep-1']);
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tnever-opens\tsep-1 is a separator, a line in the sidebar with nothing to show');
        expect(lines.slice(1)).toEqual(VIEW_LINES);
        expect(watching).toEqual([]);
    });

    test('an id the project does not have is refused with the views it does', async () => {
        const { status, lines } = await post('open', ['Board']);
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tunknown-view\tBoard is not a view of this project');
        expect(lines.slice(1)).toEqual([...VIEW_LINES, 'note\topen takes a view id, never a name']);
        expect(watching).toEqual([]);
    });

    test('takes one id, and nothing that would make it a dry run', async () => {
        expect((await post('open', [])).lines[0]).toBe('refused\tbad-arguments\topen needs the id of a view');
        expect((await post('open', ['board', 'main'])).lines[0]).toBe('refused\tbad-arguments\topen takes one view id and nothing else');
        expect((await post('open', ['board', '--dry-run'])).lines[0]).toStartWith('refused\tno-dry-run\t');
        expect(watching).toEqual([]);
    });

    test('a session that is in no project of this machine shows nobody anything', async () => {
        expect((await post('open', ['board'], 'stray')).lines[0]).toStartWith('refused\tnot-in-project\t');
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

describe('group', () => {
    test('draws the frame a person grouping the same selection would have drawn', async () => {
        await seed(box('a', 400, 400), box('b', 800, 600));
        const { status, lines } = await post('group', ['--nodes', 'a,b']);
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
        const { lines } = await post('group', ['--nodes', 'a,b', '--label', 'Parser work', '--color', 'violet']);
        expect(lines[0]!.split('\t')[2]).toBe('Parser work');
        expect(await nodeOnDisk(lines[0]!.split('\t')[0]!)).toMatchObject({ title: 'Parser work', accent: 'violet' });

        const bad = await post('group', ['--nodes', 'a', '--color', '#ff0000']);
        expect(bad.status).toBe(422);
        expect(bad.lines[0]).toBe(`refused\tunknown-color\t#ff0000 is not one of the ${NODE_ACCENT_NAMES.length} colors a frame takes`);
        expect(bad.lines[1]).toBe(['colors', ...NODE_ACCENT_NAMES].join('\t'));
    });

    test('says which nodes it caught that were not named', async () => {
        await seed(box('a', 400, 400), box('b', 800, 600), box('between', 600, 500));
        const { lines } = await post('group', ['--nodes', 'a,b']);
        expect(lines[0]!.split('\t')[4]).toBe('3');
        expect(lines.slice(1)).toEqual(['also\tbetween\tnote\tbetween']);
    });

    test('refuses a group, since the client leaves one out of a selection too', async () => {
        await seed(box('a', 400, 400), box('frame', 300, 300, { kind: 'group', w: 800, h: 800 }));
        const { status, lines } = await post('group', ['--nodes', 'a,frame']);
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tnot-groupable\tframe is a group');
        expect((await canvasOnDisk()).nodes.filter((node) => node.kind === 'group')).toHaveLength(1);
    });

    test('a refusal over an id never offers the frame this verb refuses a line later', async () => {
        await seed(box('a', 400, 400), box('frame', 300, 300, { kind: 'group', w: 800, h: 800 }));
        for (const verb of ['group', 'arrange']) {
            const { lines } = await post(verb, ['--nodes', 'a,ghost']);
            expect(lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
            expect(lines.slice(1)).not.toContain('node\tframe\tgroup\tframe');
            expect(lines.slice(1)).toContain('node\ta\tnote\ta');
        }
    });

    test('refuses nodes that do not stand in the same place already', async () => {
        await seed(box('inside', 400, 400), box('outside', 4000, 4000), box('frame', 300, 300, { kind: 'group', w: 800, h: 800 }));
        const { status, lines } = await post('group', ['--nodes', 'inside,outside']);
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
        const { lines } = await post('group', ['--nodes', 'one,two']);
        const id = lines[0]!.split('\t')[0]!;
        expect((await nodeOnDisk('frame'))!.memberIds).toEqual(['one', 'two', id]);
    });

    test('refuses an id that is not on the canvas, and says nothing about titles', async () => {
        await seed(box('a', 400, 400));
        const missing = await post('group', ['--nodes', 'a,ghost']);
        expect(missing.lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
        expect(missing.lines.slice(1)).toContain('node\ta\tnote\ta');
        expect((await post('group', ['--nodes', 'a,'])).lines[0]).toStartWith('refused\tbad-arguments\t');
        expect((await post('group', [])).lines[0]).toBe('refused\tbad-arguments\t--nodes needs one or more node ids, separated by commas');
        expect((await post('group', ['--nodes', 'a', '--dry-run'])).lines[0]).toStartWith('refused\tno-dry-run\t');
    });

    test('works on another canvas than the caller is on, and only through --view', async () => {
        await store.mutate(projectId, (current) => {
            const next = structuredClone(current);
            (next.views[2] as ProjectCanvasView).nodes.push(box('far', 0, 0));
            return { content: next, result: null };
        });
        expect((await post('group', ['--nodes', 'far'])).lines[0]).toBe('refused\tunknown-node\tfar is not a node on main');
        const { lines } = await post('group', ['--nodes', 'far', '--view', 'board']);
        expect(lines[0]!.split('\t')[3]).toBe('board');
    });
});

describe('arrange', () => {
    test('lays the nodes out from the corner they already occupied and prints where each one went', async () => {
        await seed(box('a', 1000, 1000), box('b', 4000, 2000), box('c', 2000, 3000));
        expect((await post('nodes', [])).lines).toContain('b\tnote\tb\t4000\t2000\t200\t100\t');

        const { status, lines } = await post('arrange', ['--nodes', 'a,b,c']);
        expect(status).toBe(200);
        // Two columns for three nodes, 40 px apart, starting at the top left of the box they filled.
        expect(lines).toEqual(['a\t1000\t1000', `b\t${1000 + 200 + PLACEMENT_GAP}\t1000`, `c\t1000\t${1000 + 100 + PLACEMENT_GAP}`]);
        expect(await nodeOnDisk('b')).toMatchObject({ x: 1240, y: 1000, w: 200, h: 100 });
    });

    test('--layout row and column are one row and one column', async () => {
        await seed(box('a', 0, 0), box('b', 500, 500));
        expect((await post('arrange', ['--nodes', 'a,b', '--layout', 'row'])).lines).toEqual(['a\t0\t0', 'b\t240\t0']);
        expect((await post('arrange', ['--nodes', 'a,b', '--layout', 'column'])).lines).toEqual(['a\t0\t0', 'b\t0\t140']);
    });

    test('--cols is the grid and nothing else', async () => {
        await seed(box('a', 0, 0), box('b', 500, 500), box('c', 900, 100));
        expect((await post('arrange', ['--nodes', 'a,b,c', '--cols', '3'])).lines).toEqual(['a\t0\t0', 'b\t240\t0', 'c\t480\t0']);

        const wrongLayout = await post('arrange', ['--nodes', 'a,b,c', '--layout', 'row', '--cols', '2']);
        expect(wrongLayout.status).toBe(422);
        expect(wrongLayout.lines[0]).toBe('refused\tflag-not-for-layout\t--cols does not go with row; a row is one row and a column is one column');

        const tooMany = await post('arrange', ['--nodes', 'a,b', '--cols', '5']);
        expect(tooMany.lines[0]).toBe('refused\ttoo-many-columns\t--cols is 5 and you named 2 nodes; a grid holds at most one column per node');
        expect((await post('arrange', ['--nodes', 'a', '--cols', 'two'])).lines[0]).toStartWith('refused\tbad-arguments\t--cols needs a whole number');
        expect((await post('arrange', ['--nodes', 'a', '--layout', 'circle'])).lines[0]).toStartWith('refused\tbad-arguments\t--layout takes one of');
    });

    test('keeps the sizes and never lets two of them touch', async () => {
        await seed(box('wide', 0, 0, { w: 560, h: 360 }), box('tall', 100, 100, { w: 200, h: 520 }), box('small', 50, 50));
        await post('arrange', ['--nodes', 'wide,tall,small', '--layout', 'row']);
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
        const { status, lines } = await post('arrange', ['--nodes', 'a,frame']);
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tnot-arrangeable\tframe is a group and carries whatever stands inside it');
        expect(await nodeOnDisk('a')).toMatchObject({ x: 0, y: 0 });
    });

    test('nodes that already stand where this would put them are reported and nothing is written', async () => {
        await seed(box('a', 0, 0), box('b', 240, 0));
        await post('arrange', ['--nodes', 'a,b', '--layout', 'row']);
        const rev = (await onDisk()).rev;
        const { lines } = await post('arrange', ['--nodes', 'a,b', '--layout', 'row']);
        expect(lines).toEqual(['a\t0\t0', 'b\t240\t0']);
        expect((await onDisk()).rev).toBe(rev);
    });

    test('refuses an id that is not on the canvas and takes no dry run', async () => {
        expect((await post('arrange', ['--nodes', 'ghost'])).lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
        expect((await post('arrange', ['--nodes', 'note-1', '--dry-run'])).lines[0]).toStartWith('refused\tno-dry-run\t');
        expect((await post('arrange', [])).lines[0]).toBe('refused\tbad-arguments\t--nodes needs one or more node ids, separated by commas');
    });
});

describe('rename', () => {
    test('names a node for good, so the session never renames over it', async () => {
        const { status, lines } = await post('rename', ['--node', 'term-1', '--title', 'Build the parser']);
        expect(status).toBe(200);
        expect(lines).toEqual(['term-1\tterminal\tBuild the parser']);
        expect(await nodeOnDisk('term-1')).toMatchObject({ title: 'Build the parser', titleSource: 'user' });
    });

    test('the title it already carries writes nothing', async () => {
        await post('rename', ['--node', 'note-1', '--title', 'Plan']);
        const rev = (await onDisk()).rev;
        const { lines } = await post('rename', ['--node', 'note-1', '--title', 'Plan']);
        expect(lines).toEqual(['note-1\tnote\tPlan']);
        expect((await onDisk()).rev).toBe(rev);
    });

    test('one node per call, by id, with the same cap on a name as everywhere else', async () => {
        const missing = await post('rename', ['--node', 'shell', '--title', 'x']);
        expect(missing.status).toBe(422);
        expect(missing.lines[0]).toBe('refused\tunknown-node\tshell is not a node on main');
        expect(missing.lines.slice(1)).toContain('node\tterm-1\tterminal\tshell');
        expect((await post('rename', ['--node', 'term-1', '--title', 'x'.repeat(MAX_TITLE_LENGTH + 1)])).lines[0]).toBe(
            `refused\tbad-arguments\t--title is ${MAX_TITLE_LENGTH + 1} characters and at most ${MAX_TITLE_LENGTH} fit in a name on the canvas`
        );
        expect((await post('rename', ['--node', 'term-1'])).lines[0]).toBe('refused\tbad-arguments\t--title needs a title');
        expect((await post('rename', ['--title', 'x'])).lines[0]).toBe('refused\tbad-arguments\t--node needs the id of a node');
        expect((await post('rename', ['term-1', '--title', 'x'])).lines[0]).toStartWith('refused\tbad-arguments\trename takes no arguments');
        expect((await onDisk()).rev).toBe(1);
    });
});

describe('notify', () => {
    test('a message travels along a line from the caller and nowhere else', async () => {
        const target = (await post('node', ['terminal', '--title', 'builder'])).lines[0]!.split('\t')[0]!;
        const refused = await post('notify', [target, '--text', 'the build is green']);
        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe(
            `refused\tnot-linked\t${target} is a terminal node on main, but no line runs from you into it: draw that line and it can be notified`
        );
        expect(refused.lines).toContain(
            `note\tNothing on main has a line from you into it yet; ruimte-context link --to ${target} draws the one this call needs`
        );
        expect(refused.lines).toContain(`see\truimte-context link --to ${target}\tdraws the line this needs`);
        expect(notified).toEqual([]);

        await post('link', ['--to', target]);
        const sent = await post('notify', [target, '--text', 'the build is green']);
        expect(sent.status).toBe(200);
        expect(sent.lines).toEqual([`notified\t${target}\twaiting\t${delivery.detail}`]);
        // The sender goes along by id, with its title only so the receiver can read the line.
        expect(notified).toEqual([{ projectId, targetId: target, from: 'term-1', fromTitle: 'shell', text: 'the build is green' }]);
    });

    test('says where the message landed, in the words the daemon gave it', async () => {
        const target = (await post('node', ['terminal'])).lines[0]!.split('\t')[0]!;
        await post('link', ['--to', target]);
        delivery = { at: 'now', detail: 'printed on the screen of that terminal' };
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
        expect(lines[0]).toBe('refused\tnot-on-a-canvas\tYou are a view of your own, not a node on a canvas, so no line runs from you into anything');
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
        const note = (await post('node', ['note', '--title', 'Scratch'])).lines[0]!.split('\t')[0]!;
        await post('link', ['--to', note]);
        const { status, lines } = await post('node', ['delete', note]);
        expect(status).toBe(200);
        expect(lines).toEqual([`deleted\t${note}\tnote\tScratch`, 'edges\t1']);
        const canvas = await canvasOnDisk();
        expect(canvas.nodes.some((node) => node.id === note)).toBe(false);
        expect(canvas.edges).toEqual([]);
    });

    test('a terminal node it made stops before the canvas lets go of it', async () => {
        const made = (await post('node', ['terminal', '--title', 'runner'])).lines[0]!.split('\t')[0]!;
        const { lines } = await post('node', ['delete', made]);
        expect(lines).toEqual([`deleted\t${made}\tterminal\trunner`, `ended\t${made}\tterminal`, 'edges\t0']);
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
        const mine = (await post('node', ['note', '--title', 'Mine'])).lines[0]!.split('\t')[0]!;
        expect((await post('node', ['delete', 'nope'])).lines.slice(1)).toEqual([`node\t${mine}\tnote\tMine`]);
    });

    test('a group loses its frame and keeps its nodes where they stand', async () => {
        const first = (await post('node', ['note', '--title', 'One'])).lines[0]!.split('\t')[0]!;
        const second = (await post('node', ['note', '--title', 'Two'])).lines[0]!.split('\t')[0]!;
        const group = (await post('group', ['--nodes', `${first},${second}`, '--label', 'Work'])).lines[0]!.split('\t')[0]!;
        const { lines } = await post('node', ['delete', group]);
        expect(lines).toEqual([`deleted\t${group}\tgroup\tWork`, 'edges\t0', 'members\t2\tleft where they stand']);
        const nodes = (await canvasOnDisk()).nodes.map((node) => node.id);
        expect(nodes).toContain(first);
        expect(nodes).toContain(second);
        expect(nodes).not.toContain(group);
    });
});

describe('diagram', () => {
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
        post('diagram', [viewId, `--document=${document}`], token);

    const diagramOnDisk = async (viewId: string, base = folder): Promise<unknown> =>
        readFile(join(base, '.ruimte', 'diagrams', `${viewId}.json`), 'utf8')
            .then((text) => JSON.parse(text))
            .catch(() => null);

    test('help diagram names every field of the document and every value a closed field takes', async () => {
        const { lines } = await post('help', ['diagram']);
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
        expect(lines.at(-1)).toBe('detail\truimte-context help diagram');
        for (const line of lines) {
            expect(line).not.toInclude('Invalid');
            expect(line).not.toInclude('expected');
        }
        expect(await diagramOnDisk(id)).toBeNull();
    });

    test('no document, one that is not JSON, one that is not an object and a --dry-run are each refused by name', async () => {
        const id = await made('Flow', ['--kind', 'diagram']);
        expect((await post('diagram', [id])).lines[0]).toStartWith('refused\tno-document\t');
        expect((await write(id, '  \n')).lines[0]).toStartWith('refused\tno-document\t');
        expect((await write(id, '{ nodes: [')).lines[0]).toStartWith('refused\tbad-json\tThe document is not JSON: ');
        expect((await write(id, '[]')).lines[0]).toBe('refused\tbad-document\tdocument needs to be one JSON object with meta, nodes, groups and edges');
        expect((await write(id, JSON.stringify({ nodes: [], groups: [], edges: [] }))).lines[0]).toBe(
            'refused\tbad-document\tmeta is missing and needs an object'
        );
        expect((await post('diagram', [id, '--dry-run', `--document=${doc()}`])).lines[0]).toStartWith('refused\tno-dry-run\t');
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

describe('tasks', () => {
    // The chat view `chat-1` is a chat, the one kind of caller that can be woken with a result.
    const give = (argv: string[]) => post('agent', ['claude', '--chat', '--view', 'main', ...argv], 'chat');

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

    test('team --task gives every role a task of its own', async () => {
        const roles = JSON.stringify([
            { title: 'Lexer', prompt: 'fix the tokenizer', provider: 'claude' },
            { title: 'Docs', prompt: 'write the docs', provider: 'claude', chat: true }
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
            expect((await post('tasks', [], 'chat')).lines).toEqual([`task\t${taskId}\tgave\tdone\t${childId}\tLexer\tpending\tFixed\t-`]);
            expect((await post('tasks', [], 'child')).lines).toEqual([`task\t${taskId}\tgiven\tdone\tchat-1\tLexer\tpending\tFixed\t-`]);
            expect((await post('tasks', [], 'term')).lines).toEqual([
                'note\tYou have given no task and were given none; ruimte-context agent --task gives one'
            ]);
        } finally {
            delete TOKENS.child;
        }
    });
});
