import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NODE_SIZE, type ProjectCanvasView, type ProjectContent, type ProjectDocument } from '@ruimte/contracts';
import { documentPathInFolder } from '../projects/project-files.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { CANVAS_PATH, handleCanvasRequest } from './canvas-route.ts';
import { MAX_CANVAS_NODES } from './node-verb.ts';
import { PLACEMENT_GAP } from './placement.ts';
import type { CanvasHost } from './verb.ts';
import { VERBS } from './verbs.ts';

let root: string;
let folder: string;
let outside: string;
let worktree: string;
let store: ProjectStore;
let projectId: string;
let worktrees: string[];

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
    worktreePaths: async () => worktrees
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

    test('an unknown verb is a 404 refusal', async () => {
        const { status, lines } = await post('agent', ['claude']);
        expect(status).toBe(404);
        expect(lines[0]).toStartWith('refused\tunknown-verb\t');
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
    test('renders one line per verb from the registry, then the one line about refusals', async () => {
        const { status, lines } = await post('help', []);
        expect(status).toBe(200);
        expect(lines.slice(0, -1)).toEqual(VERBS.map((verb) => `${verb.name}\t${verb.usage}\t${verb.summary}`));
        expect(lines.map((line) => line.split('\t')[0])).toEqual(['help', 'list', 'read', 'nodes', 'views', 'node', 'refusal']);
        expect(lines[2]).toBe('read\t<id>\tPrints one linked source');
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
        expect(lines).toContain('kind\tbrowser\t--url\tcalled "Browser" without --title');
        expect(lines).toContain('flag\t--url U\tbrowser (required)\tAn http or https address');
        expect(lines).toContain('flag\t--cwd P\tterminal, chat\tThe directory the shell starts in');
        expect(lines.filter((line) => line.startsWith('where\t')).length).toBe(2);
        expect(lines.filter((line) => line.startsWith('paths\t')).length).toBe(2);
        expect(lines.some((line) => line.includes('--text - takes the body from stdin'))).toBe(true);
    });

    test('help views says a separator has no name', async () => {
        expect((await post('help', ['views'])).lines).toContain('note\tA separator is a line in the sidebar and has an empty name');
    });

    test('a verb it does not have is refused with the list', async () => {
        const { status, lines } = await post('help', ['agent']);
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tunknown-verb\tagent is not a verb');
        expect(lines.slice(1)).toEqual(VERBS.map((verb) => `${verb.name}\t${verb.usage}\t${verb.summary}`));
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
                message: '--cmd is not one of --title, --text, --url, --path, --source, --cwd, --view, --beside'
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
