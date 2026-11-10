import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchCwdOf, launchGap } from '../src/launch-rules.ts';
import { groupFrame } from '../src/node-defaults.ts';
import { deriveNodeTitle } from '../src/node-title.ts';
import { projectSidebarRowHead, projectSidebarSelf, projectSidebarViews } from '../src/project-sidebar.ts';
import { ProjectViewSchema, type ProjectView } from '../src/project.ts';
import { sessionStatus, type SessionReading } from '../src/session-status.ts';
import { freeSlug, slugOf } from '../src/slug.ts';

/*
 * The cases the iPhone app holds its Swift copies of Ruimte's rules to, each with the answer the TypeScript rule gives.
 * Every `expected` is computed here by calling the rule, never written by hand, so a change to a rule fails
 * `check:swift` until the fixture is regenerated and the Swift test reads the new answer.
 */
const destination = resolve(import.meta.dir, '../../../apps/ios/Tests/Fixtures/ports.json');

/*
 * The client's canvas store holds the rule for a line between two nodes. It is loaded by path, since the client's `@/`
 * imports resolve in its own tsconfig and this package's type check must not read the client; only what is used here
 * is typed.
 */
interface CanvasStoreLike {
    setState(state: Record<string, unknown>): void;
    getState(): { addEdge(from: string, to: string): string | null; edges: { from: string; to: string; label?: string }[] };
}

const { createCanvasStore } = (await import(resolve(import.meta.dir, '../../../apps/client/src/state/canvas.ts'))) as {
    createCanvasStore(): CanvasStoreLike;
};

const SPACE_NINES = '12345678 '.repeat(5).trim();

const titlePrompts = [
    '',
    '   ',
    '\n\n  \n',
    'Fix the login bug',
    'Fix the login bug.',
    'Hello!!!?',
    '...',
    ' . , ; : ! ? ',
    '\n\n  first line  \nsecond line',
    'tabs\tand\u00a0nbsp\u2003and   spaces',
    'line one\r\nline two',
    'line\u2028separator',
    '\ufeffbom first',
    'a'.repeat(47),
    'a'.repeat(48),
    'a'.repeat(49),
    'a'.repeat(100),
    `${'word '.repeat(9)}tail`,
    `${'word '.repeat(10)}tail`,
    'Refactor the authentication middleware so tokens refresh quietly, then update the docs',
    'Refactor the authentication middleware so that, finally',
    'Refactor the authentication middleware so tokens refresh!!! now',
    `${'a'.repeat(30)} ${'b'.repeat(30)}`,
    `${'a'.repeat(10)} ${'b'.repeat(60)}`,
    `${'a'.repeat(47)}\u{1F680}`,
    `${'a'.repeat(46)}\u{1F680} tail`,
    `${'a'.repeat(47)}e\u0301`,
    `${'a'.repeat(46)}e\u0301e\u0301`,
    '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} '.repeat(8),
    '\u65E5\u672C\u8A9E\u306E\u30BF\u30B9\u30AF\u3092\u59CB\u3081\u3066\u304F\u3060\u3055\u3044\u3002'.repeat(4),
    'caf\u00E9 \u2014 r\u00E9sum\u00E9 and na\u00EFve fa\u00E7ade of the s\u00F8ren project plan',
    SPACE_NINES,
    `${SPACE_NINES}.`,
    '\u{1F1F3}\u{1F1F1}'.repeat(30),
    `${'a'.repeat(24)} ${'b'.repeat(40)}`,
    `${'a'.repeat(25)} ${'b'.repeat(40)}`,
    `${'a'.repeat(23)} ${'b'.repeat(40)}`
];

const slugNames: [string, string, number?][] = [
    ['', 'launch'],
    ['   ', 'launch'],
    ['Web: Dev', 'launch'],
    ['Dev Server!', 'launch'],
    ['  --Already-Dashed--  ', 'launch'],
    ['Caf\u00E9 Cr\u00E8me', 'launch'],
    ['\u00C5ngstr\u00F6m', 'launch'],
    ['\u65E5\u672C\u8A9E', 'launch'],
    ['\u65E5\u672C\u8A9E', 'fallback'],
    ['\u{1F680}', 'launch'],
    ['\uFB01nal \u2460 \u00B2', 'launch'],
    ['Ünï\u0063ode', 'launch'],
    ['UPPER lower 123', 'launch'],
    ['a'.repeat(60), 'launch'],
    [`${'a'.repeat(47)} b`, 'launch'],
    [`${'a'.repeat(46)} bcd`, 'launch'],
    [`${'ab '.repeat(30)}`, 'launch'],
    ['a_b.c/d\\e', 'launch'],
    ['1st', 'launch'],
    ['x', 'launch', 1],
    ['hello world', 'launch', 6],
    ['hello world', 'launch', 5],
    ['hello world', 'launch', 0]
];

const freeSlugs: { name: string; fallback: string; taken: string[] }[] = [
    { name: 'Dev', fallback: 'launch', taken: [] },
    { name: 'Dev', fallback: 'launch', taken: ['dev'] },
    { name: 'Dev', fallback: 'launch', taken: ['dev', 'dev-2', 'dev-3'] },
    { name: 'Dev', fallback: 'launch', taken: ['dev-2'] },
    { name: '', fallback: 'launch', taken: ['launch'] },
    { name: '\u65E5\u672C\u8A9E', fallback: 'launch', taken: ['launch', 'launch-2'] }
];

// A project folder of '/' is left out: `collapsed` keeps both separators of its root.
const launchFolders = ['/work/p', '/work/p/', 'C:\\work\\p', 'C:\\work\\p\\', '\\\\server\\share\\p', '/work//p'];
const launchCwds: (string | undefined)[] = [
    undefined,
    '',
    '   ',
    '.',
    './',
    './apps/site',
    'apps/site',
    'apps/site/',
    'apps//site',
    'apps/./site/.',
    'apps/../libs',
    '../other',
    '../../..',
    '/abs/path',
    '/abs/path/',
    '/abs/../x',
    '  apps/site  ',
    '\tapps\n',
    'apps\\site',
    'D:\\other',
    'D:/other/',
    '\\\\server\\share',
    'C:rel',
    '..'
];

type LaunchInput = { cwd?: string; overlay?: { cwd?: string } };
const launchCwdCases: { folder: string; launch: LaunchInput }[] = [];

for (const folder of launchFolders) {
    for (const cwd of launchCwds) {
        launchCwdCases.push({ folder, launch: cwd === undefined ? {} : { cwd } });
    }
}

launchCwdCases.push(
    { folder: '/work/p', launch: { cwd: 'a', overlay: { cwd: '/elsewhere' } } },
    { folder: '/work/p', launch: { cwd: 'a', overlay: { cwd: '' } } },
    { folder: '/work/p', launch: { cwd: 'a', overlay: {} } },
    { folder: '/work/p', launch: { overlay: { cwd: 'sub/dir' } } },
    { folder: '/work/p', launch: { cwd: '/abs', overlay: { cwd: '../up' } } }
);

const gapCases: { kind: 'service' | 'task' | 'group'; command?: string; launches?: string[] }[] = [
    { kind: 'group' },
    { kind: 'group', launches: [] },
    { kind: 'group', launches: ['a'] },
    { kind: 'group', launches: ['a', 'b'], command: '' },
    { kind: 'task' },
    { kind: 'task', command: '' },
    { kind: 'task', command: '   ' },
    { kind: 'task', command: '\t\n' },
    { kind: 'task', command: '\u00a0' },
    { kind: 'task', command: 'bun dev' },
    { kind: 'task', command: '  bun dev  ' },
    { kind: 'task', command: '', launches: ['a'] },
    { kind: 'service' },
    { kind: 'service', command: 'x' }
];

const frameCases: { x: number; y: number; w: number; h: number }[][] = [
    [],
    [{ x: 0, y: 0, w: 0, h: 0 }],
    [{ x: 100, y: 100, w: 200, h: 100 }],
    [
        { x: 100, y: 100, w: 200, h: 100 },
        { x: 400, y: 100, w: 200, h: 100 }
    ],
    [
        { x: 36, y: 36, w: 7, h: 9 },
        { x: -36, y: -44, w: 13, h: 5 }
    ],
    [{ x: -44, y: -76, w: 1, h: 1 }],
    [{ x: 10.5, y: 20.25, w: 99.5, h: 40.75 }],
    [
        { x: -500, y: -300, w: 400, h: 300 },
        { x: 800, y: 900, w: 320, h: 200 },
        { x: 0, y: 0, w: 5000, h: 10 }
    ],
    [
        { x: 4, y: 4, w: 8, h: 8 },
        { x: 12, y: 12, w: 8, h: 8 }
    ],
    [{ x: 20, y: 20, w: 20, h: 20 }],
    [{ x: 28, y: 12, w: 3, h: 3 }]
];

type EdgeNode = { id: string; kind: string; collapsed?: boolean };
type EdgeCase = { nodes: EdgeNode[]; edges: { from: string; to: string }[]; from: string; to: string };

const edgeNodes: EdgeNode[] = [
    { id: 'shell', kind: 'terminal' },
    { id: 'talk', kind: 'chat' },
    { id: 'plan', kind: 'design' },
    { id: 'page', kind: 'browser' },
    { id: 'memo', kind: 'note' },
    { id: 'frame', kind: 'group' },
    { id: 'phone', kind: 'device' },
    { id: 'folded-chat', kind: 'chat', collapsed: true },
    { id: 'folded-note', kind: 'note', collapsed: true }
];

const edgeCases: EdgeCase[] = [];
const edgePairs: [string, string][] = [
    ['page', 'memo'],
    ['memo', 'frame'],
    ['frame', 'shell'],
    ['page', 'talk'],
    ['talk', 'page'],
    ['shell', 'talk'],
    ['talk', 'shell'],
    ['plan', 'shell'],
    ['shell', 'plan'],
    ['plan', 'memo'],
    ['memo', 'plan'],
    ['plan', 'talk'],
    ['phone', 'talk'],
    ['page', 'page'],
    ['page', 'missing'],
    ['missing', 'page'],
    ['folded-chat', 'talk'],
    ['talk', 'folded-chat'],
    ['folded-note', 'memo'],
    ['memo', 'folded-note'],
    ['folded-chat', 'folded-chat']
];

for (const [from, to] of edgePairs) {
    edgeCases.push({ nodes: edgeNodes, edges: [], from, to });
}

edgeCases.push(
    { nodes: edgeNodes, edges: [{ from: 'page', to: 'memo' }], from: 'page', to: 'memo' },
    { nodes: edgeNodes, edges: [{ from: 'page', to: 'memo' }], from: 'memo', to: 'page' },
    { nodes: edgeNodes, edges: [{ from: 'shell', to: 'talk' }], from: 'shell', to: 'talk' },
    { nodes: edgeNodes, edges: [{ from: 'shell', to: 'talk' }], from: 'talk', to: 'shell' },
    { nodes: edgeNodes, edges: [{ from: 'talk', to: 'shell' }], from: 'shell', to: 'talk' },
    { nodes: edgeNodes, edges: [{ from: 'plan', to: 'talk' }], from: 'talk', to: 'plan' },
    {
        nodes: edgeNodes,
        edges: [
            { from: 'shell', to: 'talk' },
            { from: 'talk', to: 'shell' }
        ],
        from: 'shell',
        to: 'talk'
    }
);

function edgesDrawn(testCase: EdgeCase): { from: string; to: string; label: string | null }[] {
    const store = createCanvasStore();

    store.setState({
        nodes: Object.fromEntries(
            testCase.nodes.map((node, index) => [
                node.id,
                { id: node.id, kind: node.kind, title: node.id, x: index * 400, y: 0, w: 200, h: 100, ...(node.collapsed ? { collapsed: true } : {}) }
            ])
        ),
        texts: {},
        order: testCase.nodes.map((node) => node.id),
        edges: testCase.edges.map((edge, index) => ({ id: `known-${index}`, ...edge })),
        selection: [],
        linkDraft: null
    });
    store.getState().addEdge(testCase.from, testCase.to);

    return store
        .getState()
        .edges.slice(testCase.edges.length)
        .map((edge) => ({ from: edge.from, to: edge.to, label: edge.label ?? null }));
}

const sessionAgents: (SessionReading['agent'] | undefined)[] = [
    undefined,
    null,
    { live: true, status: 'running' },
    { live: true, status: 'needs-you' },
    { live: true, status: 'idle' },
    { live: true, status: 'error' },
    { live: true, status: 'exited' },
    { live: false, status: 'exited' },
    { live: false, status: 'running' },
    { live: false, status: 'needs-you' },
    { live: false, status: 'idle' }
];

const sessionCases: { state: SessionReading | null }[] = [{ state: null }];

for (const agent of sessionAgents) {
    for (const attached of [false, true]) {
        for (const exited of [undefined, 0, 1, 137]) {
            sessionCases.push({ state: { attached, ...(exited === undefined ? {} : { exited }), ...(agent === undefined ? {} : { agent }) } });
        }
    }
}

const node = (id: string, kind: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    kind,
    title: `${id} title`,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    ...extra
});

const sidebarViews: unknown[] = [
    {
        kind: 'canvas',
        id: 'board',
        name: 'Board',
        nodes: [
            node('t1', 'terminal', { provider: 'claude' }),
            node('t2', 'terminal'),
            node('c1', 'chat', { provider: 'codex' }),
            node('c2', 'chat'),
            node('d1', 'design', { provider: 'claude' }),
            node('b1', 'browser'),
            node('v1', 'device'),
            node('n1', 'note'),
            node('g1', 'group'),
            node('w1', 'drawing', { viewId: 'sketch' }),
            node('f1', 'file')
        ],
        texts: [],
        edges: []
    },
    { kind: 'canvas', id: 'elsewhere', name: 'Other machine', hidden: true, nodes: [node('x1', 'chat')], texts: [], edges: [] },
    { kind: 'canvas', id: 'bare', name: 'Bare', nodes: [], texts: [], edges: [] },
    { kind: 'terminal', id: 'shell', name: 'Shell', node: { provider: 'codex' } },
    { kind: 'terminal', id: 'plain-shell', name: 'Plain shell', node: {} },
    { kind: 'chat', id: 'talk', name: 'Talk', node: { provider: 'claude' } },
    { kind: 'chat', id: 'talk-fixed', name: 'Fixed', node: {} },
    { kind: 'chat', id: 'talk-empty', name: 'Nobody wrote here', node: {}, empty: true },
    { kind: 'chat', id: 'talk-hidden', name: 'Inline edit', node: {}, hidden: true },
    { kind: 'chat', id: 'talk-drawn', name: 'Drawn by an extension', node: {}, drawnBy: 'pets' },
    { kind: 'chat', id: 'talk-empty-hidden', name: 'Both', node: {}, empty: true, hidden: true },
    { kind: 'browser', id: 'web', name: 'Docs', url: 'https://example.com', titleSource: 'user' },
    { kind: 'file', id: 'readme', name: 'README', path: 'docs/README.md' },
    { kind: 'file', id: 'outside', name: 'Outside', path: '/etc/hosts' },
    { kind: 'drawing', id: 'sketch', name: 'Sketch' },
    { kind: 'diagram', id: 'flow', name: 'Flow' },
    { kind: 'separator', id: 'sep', name: 'sep' },
    { kind: 'subheader', id: 'sub', name: 'Later' }
];

const sidebarShared = ['board', 'talk', 'readme'];
const sidebarFlags = { board: 'red', talk: 'blue', shell: 'ultraviolet' };

function sidebarCases(): unknown {
    const views = sidebarViews.map((raw) => ProjectViewSchema.parse(raw) as ProjectView);
    const listed = new Map(projectSidebarViews(views, sidebarShared, sidebarFlags).map((row) => [row.id, row]));

    return {
        shared: sidebarShared,
        flags: sidebarFlags,
        views: sidebarViews.map((raw, index) => {
            const view = views[index]!;
            const row = listed.get(view.id);

            return {
                view: raw,
                listed: row !== undefined,
                head: projectSidebarRowHead(view, sidebarShared, sidebarFlags),
                self: projectSidebarSelf(view),
                row: row ?? null
            };
        })
    };
}

const ports = {
    nodeTitle: titlePrompts.map((prompt) => ({ prompt, title: deriveNodeTitle(prompt) })),
    slug: slugNames.map(([name, fallback, maxLength]) => ({
        name,
        fallback,
        ...(maxLength === undefined ? {} : { maxLength }),
        slug: slugOf(name, fallback, maxLength)
    })),
    freeSlug: freeSlugs.map((entry) => ({ ...entry, slug: freeSlug(entry.name, entry.fallback, new Set(entry.taken)) })),
    launchCwd: launchCwdCases.map((entry) => ({ ...entry, cwd: launchCwdOf(entry.folder, entry.launch) })),
    launchGap: gapCases.map((launch) => ({ launch, gap: launchGap(launch) })),
    groupFrame: frameCases.map((members) => ({ members, frame: groupFrame(members) })),
    addEdge: edgeCases.map((entry) => ({ ...entry, drawn: edgesDrawn(entry) })),
    sessionStatus: sessionCases.map(({ state }) => ({ state, status: sessionStatus(state ?? undefined) ?? null })),
    sidebar: sidebarCases()
};

const contents = `${JSON.stringify(ports, null, 2)}\n`;

if (process.argv.includes('--check')) {
    if ((await readFile(destination, 'utf8').catch(() => '')) !== contents) {
        throw new Error(`Stale generated file: ${destination}`);
    }
} else {
    await mkdir(resolve(destination, '..'), { recursive: true });
    await writeFile(destination, contents);
}

console.log(`${process.argv.includes('--check') ? 'Checked' : 'Generated'} ${Object.keys(ports).length} groups of port cases.`);
