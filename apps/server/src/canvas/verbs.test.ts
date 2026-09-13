import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextSourceSchema, NODE_SIZE, type AgentKind, type ProjectCanvasView, type ProjectContent, type ProjectDocument } from '@ruimte/contracts';
import { SESSION_VARIABLES } from '../config.ts';
import { MAX_SCREEN_LINES } from '../context/context-store.ts';
import { documentPathInFolder } from '../projects/project-files.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { AgentLineageStore } from '../agents/lineage.ts';
import { MAX_PROMPT_LENGTH } from '../agents/pending-prompts.ts';
import { CANVAS_PATH, handleCanvasRequest } from './canvas-route.ts';
import { MAX_AGENT_DEPTH, MAX_OPENED_PER_CALLER, MAX_TEAM_DEPTH } from './depth.ts';
import { AGENT_KINDS, NEW_NODE } from './agent-verb.ts';
import { MAX_LINKS } from './link-verb.ts';
import { MAX_CANVAS_NODES } from './node-verb.ts';
import { PLACEMENT_GAP } from './placement.ts';
import { MAX_ROLES, ROLES_SHAPE } from './team-verb.ts';
import type { CanvasHost } from './verb.ts';
import { VERBS } from './verbs.ts';

let root: string;
let folder: string;
let outside: string;
let worktree: string;
let store: ProjectStore;
let projectId: string;
let worktrees: string[];
let installed: AgentKind[];
let held: Array<{ projectId: string; nodeId: string; prompt: string }>;
let lineage: AgentLineageStore;

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
    installed = ['claude', 'codex', 'gemini', 'copilot'];
    held = [];
    lineage = new AgentLineageStore(join(root, 'home'));
    await lineage.load();
    store = new ProjectStore(join(root, 'home'));
    const opened = await store.openProject({ folder });
    projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, content());
    // Released, like a project the person switched away from while its agents keep working.
    store.release(projectId);
});

afterEach(async () => {
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

const host = (): CanvasHost => ({
    locate: (id) => store.index.locate(id),
    read: (id) => store.read(id),
    mutate: store.mutate.bind(store),
    worktreePaths: async () => worktrees,
    installedAgents: async () => installed,
    holdPrompt: async (projectId, nodeId, prompt) => {
        held.push({ projectId, nodeId, prompt });
    },
    depthOf: (nodeId) => lineage.depthOf(nodeId),
    openedCount: (callerId) => lineage.openedCount(callerId),
    recordOpened: (projectId, nodeId, openedBy, depth) => lineage.put(projectId, nodeId, openedBy, depth)
});

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
        expect(lines.slice(0, -4)).toEqual(VERBS.map((verb) => `verb\t${verb.name}\t${verb.usage}\t${verb.summary}`));
        expect(lines.map((line) => line.split('\t')[0])).toEqual([...VERBS.map(() => 'verb'), 'scope', 'dry run', 'detail', 'refusal']);
        expect(lines[2]).toBe('verb\tread\t<id>\tPrints one linked source');
        expect(lines.at(-4)).toStartWith('scope\tlist and read are what a person linked into this session;');
        expect(lines.at(-3)).toBe('dry run\t--dry-run\tnode, agent, team\tsame checks, nothing made; every other verb refuses the flag');
        expect(lines.at(-2)).toBe('detail\truimte-context help <verb>\tone verb in full');
        expect(lines.at(-1)).toBe(
            'refusal\trefused<TAB><code><TAB><message> on stderr, then what you can pick instead\texit 0 done, 1 the daemon failed, 2 not in a Ruimte session, 3 refused'
        );
    });

    test('help <verb> details one verb, synopsis first and refusals last', async () => {
        for (const verb of VERBS) {
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
        expect(lines.filter((line) => line.startsWith('where\t')).length).toBe(2);
        expect(lines.filter((line) => line.startsWith('paths\t')).length).toBe(2);
        expect(lines.some((line) => line.includes('--text - takes the body from stdin'))).toBe(true);
    });

    test('help agent covers what a first-time caller cannot see from the canvas', async () => {
        const { lines } = await post('help', ['agent']);
        expect(lines).toContain(
            'prints\tid\tkind\tview\tcli\tedge\tthe new node, its kind (terminal or chat), the canvas it landed on, the CLI it runs and the id of the edge drawn into it'
        );
        // Which CLIs take --chat, from the registry rather than from a sentence that can drift.
        expect(lines.some((line) => line.startsWith('flag\t--chat\t') && line.includes('claude, codex'))).toBe(true);
        expect(lines.some((line) => line.startsWith('flag\t--prompt T\t') && line.includes(String(MAX_PROMPT_LENGTH)))).toBe(true);
        expect(lines.some((line) => line.startsWith('paths\t') && line.includes('worktree'))).toBe(true);
        expect(lines.some((line) => line.startsWith('without a prompt\t'))).toBe(true);
        expect(lines.some((line) => line.startsWith('edge\t') && line.includes('One way only') && line.includes('ruimte-context link'))).toBe(true);
        expect(lines.some((line) => line.startsWith('groups\t') && line.includes('ruimte-context nodes'))).toBe(true);
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

    test('help nodes says which row the caller is, by a variable the session really sets', async () => {
        const self = (await post('help', ['nodes'])).lines.filter((line) => line.startsWith('self\t'));
        expect(self).toHaveLength(1);
        expect(self[0]).toInclude('$RUIMTE_SESSION_ID');
        expect(SESSION_VARIABLES).toContain('RUIMTE_SESSION_ID');
        // A chat backend is spawned without it, and help must not send one looking for what it never got.
        expect(self[0]).toInclude('a chat backend is given none');
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
            { verb: 'node', argv: [], code: 'bad-arguments', message: 'node needs a kind: note, browser, drawing, file, terminal, chat' },
            { verb: 'node', argv: ['group'], code: 'bad-arguments', message: 'node needs a kind: note, browser, drawing, file, terminal, chat' },
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
        expect(lines).toEqual(['term-1\tterminal\tshell\t0\t0\t560\t360', 'note-1\tnote\tPlan with a tab\t0\t601\t320\t240']);
    });

    test('--view picks another canvas', async () => {
        expect(await post('nodes', ['--view', 'board'])).toEqual({ status: 200, lines: [] });
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
            'main\tcanvas\tCanvas',
            'sep-1\tseparator\t',
            'board\tcanvas\tBoard',
            'chat-1\tchat\tPlanner',
            'sketch-1\tdrawing\tSketch'
        ]);
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

    test('a full canvas is refused and nothing is written', async () => {
        const full = content();
        const board = full.views[2] as ProjectCanvasView;
        board.nodes = Array.from({ length: MAX_CANVAS_NODES }, (_, i) => ({ id: `n-${i}`, kind: 'note' as const, title: 'n', x: i * 10, y: 0, w: 10, h: 10 }));
        await store.mutate(projectId, () => ({ content: full, result: null }));
        const before = await onDisk();
        expect((await post('node', ['note', '--view', 'board'])).lines[0]).toStartWith('refused\tcanvas-full\t');
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
    });

    test('--chat makes a chat node fixed to its CLI', async () => {
        const { lines } = await post('agent', ['codex', '--chat', '--title', 'Reviewer']);
        const [id, kind] = lines[0]!.split('\t');
        expect(kind).toBe('chat');
        const node = (await canvasOnDisk()).nodes.find((candidate) => candidate.id === id)!;
        expect([node.provider, node.providerFixed, node.title, node.titleSource]).toEqual(['codex', true, 'Reviewer', 'user']);
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
    });
});

describe('team', () => {
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
        expect(group).toEqual(['group', 'main', 'Crew', '-']);
        const members = lines.slice(1).map((line) => line.split('\t'));
        expect(members.map((fields) => fields.slice(1, 4))).toEqual([
            ['terminal', 'main', 'claude'],
            ['chat', 'main', 'codex'],
            ['terminal', 'main', 'gemini']
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
            ids.map((id, index) => [members[index]![4], 'term-1', id, 'context'])
        );
        expect(held).toEqual(ids.map((id, index) => ({ projectId, nodeId: id, prompt: THREE[index]!.prompt })));
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
        // Four to a row, so eight roles stand in two.
        expect(new Set(placed.map((node) => node.y)).size).toBe(2);
        // The group went beside the caller rather than over the note below it.
        const frame = canvas.nodes.find((node) => node.id === lines[0]!.split('\t')[0])!;
        expect(frame.x).toBe(560 + PLACEMENT_GAP);
    });

    test('roles that are not JSON, too few or too many are refused with the shape', async () => {
        const broken = await post('team', ['--label', 'Crew', '--roles', '[{"title":]']);
        expect(broken.status).toBe(422);
        expect(broken.lines[0]).toStartWith('refused\tbad-roles-json\t--roles is not JSON: ');
        expect(broken.lines[1]).toBe(`roles\tshape\t${ROLES_SHAPE}`);

        expect((await post('team', args(many(MAX_ROLES + 1)))).lines[0]).toBe(`refused\tbad-roles\t--roles has more than the ${MAX_ROLES} roles a team takes`);
        expect((await post('team', args([]))).lines[0]).toBe('refused\tbad-roles\t--roles has no roles in it; a team is between 1 and 8 of them');
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
                `role 0 (prompt): prompt is longer than the ${MAX_PROMPT_LENGTH} characters a launch line carries`
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
        const { lines } = await post('team', [...args(THREE), '--view', 'board'], 'chat');
        expect(lines.every((line) => line.split('\t')[2] === 'board')).toBe(true);
        // No caller on that canvas, so no edge to name in the last column either.
        expect(lines.every((line) => line.split('\t')[4] === '-')).toBe(true);
        expect((await canvasOnDisk('board')).edges).toEqual([]);
        expect(held).toHaveLength(3);
    });

    test('--dry-run says what it would open and writes nothing', async () => {
        const { status, lines } = await post('team', [...args(THREE), '--dry-run']);
        expect(status).toBe(200);
        expect(lines).toEqual([
            'dry-run\tgroup\tmain\tCrew\t-',
            `dry-run\tterminal\tmain\tclaude\tterm-1 -> ${NEW_NODE}`,
            `dry-run\tchat\tmain\tcodex\tterm-1 -> ${NEW_NODE}`,
            `dry-run\tterminal\tmain\tgemini\tterm-1 -> ${NEW_NODE}`
        ]);
        expect((await onDisk()).rev).toBe(1);
        expect(held).toEqual([]);
        expect(lineage.openedCount('term-1')).toBe(0);
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
            await lineage.put(projectId, `stub-${index}`, 'term-1', 1);
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
        const [id, from, to, state] = lines[0]!.split('\t');
        expect([from, to, state]).toEqual(['term-1', 'note-1', 'new']);
        expect((await canvasOnDisk()).edges).toEqual([{ id: id!, from: 'term-1', to: 'note-1' }]);
    });

    test('between two agents it draws both ways and labels them context', async () => {
        const pair = content();
        (pair.views[0] as ProjectCanvasView).nodes.push({ id: 'term-2', kind: 'terminal', title: 'other', x: 2000, y: 0, w: 560, h: 360 });
        await store.mutate(projectId, () => ({ content: pair, result: null }));

        const { lines } = await post('link', ['--to', 'term-2']);
        expect(lines.map((line) => line.split('\t').slice(1))).toEqual([
            ['term-1', 'term-2', 'new'],
            ['term-2', 'term-1', 'new']
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
        expect(missing.lines.slice(1)).toEqual(['node\tterm-1\tterminal\tshell', 'node\tnote-1\tnote\tPlan with a tab']);
        expect((await post('link', ['--to', 'term-1'])).lines[0]).toStartWith('refused\tself-link\t');
        expect((await post('link', ['--to', 'note-1', '--view', 'main'], 'chat')).lines[0]).toStartWith(
            'refused\tunknown-node\tYou are not a node on main, so a line has nowhere to start'
        );
        expect((await onDisk()).rev).toBe(1);
    });

    test('--from, --label and --view say where the line goes and what it is called', async () => {
        const { lines } = await post('link', ['--to', 'term-1', '--from', 'note-1', '--label', 'plan']);
        expect(lines[0]!.split('\t').slice(1)).toEqual(['note-1', 'term-1', 'new']);
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
