import type { ProjectContent, ProjectNode, ProjectView } from '@ruimte/contracts';

/*
 * The fixtures the dev-only measurements run on. Every variant is built from
 * nothing but its name, so two runs on two machines measure the same scene.
 */
export type MeasureVariant = 'scene' | 'grid' | 'files' | 'chats' | 'terminals';

export const MEASURE_VARIANTS: readonly MeasureVariant[] = ['scene', 'grid', 'files', 'chats', 'terminals'];

export interface FixtureFile {
    /* Relative to the project folder, POSIX. */
    path: string;
    text: string;
}

interface MeasureScene {
    variant: MeasureVariant;
    content: ProjectContent;
    /* How many of each kind the scene holds, counted where it is built. */
    nodes: Record<NodeKind, number>;
    files: FixtureFile[];
    /* The views of a three by three grid, column by column; null for a scene on one canvas. */
    grid: string[][] | null;
}

const NODE_W = 480;
const NODE_H = 320;
const GAP = 40;
const COLUMNS = 6;
const SMALL_FILE_BLOCKS = 80;
const LARGE_FILE_BLOCKS = 4_000;
const CANVAS_ID = 'measure-canvas';

const NAMES: Record<MeasureVariant, string> = {
    scene: 'Measure 30 nodes',
    grid: 'Measure nine cells',
    files: 'Measure ten large files',
    chats: 'Measure 100 idle chats',
    terminals: 'Measure 16 terminals'
};

/* Five lines per block, with a comment, a signature and a body, so a highlighter has every kind of token to color. */
function fixtureText(name: string, blocks: number): string {
    const lines: string[] = [];
    for (let block = 0; block < blocks; block++) {
        const label = String(block).padStart(5, '0');
        lines.push(
            `// Block ${label} of ${name}`,
            `export function block${label}(input: readonly number[]): number {`,
            `    return input.reduce((sum, value) => sum + value * ${block % 97}, ${block % 13});`,
            '}',
            ''
        );
    }
    return lines.join('\n');
}

function fixtureFile(index: number, blocks: number): FixtureFile {
    const name = `measure-${String(index + 1).padStart(2, '0')}.ts`;
    return { path: `fixtures/${name}`, text: fixtureText(name, blocks) };
}

function placed(index: number): Pick<ProjectNode, 'x' | 'y' | 'w' | 'h'> {
    return {
        x: (index % COLUMNS) * (NODE_W + GAP),
        y: Math.floor(index / COLUMNS) * (NODE_H + GAP),
        w: NODE_W,
        h: NODE_H
    };
}

type NodeKind = 'terminal' | 'chat' | 'file';

/* Session ids are the node ids, so they carry the variant: two scenes on one machine never share a session. */
function nodeId(variant: MeasureVariant, kind: NodeKind, index: number): string {
    return `measure-${variant}-${kind}-${String(index + 1).padStart(3, '0')}`;
}

function canvasOf(variant: MeasureVariant, kinds: readonly NodeKind[], files: readonly FixtureFile[]): ProjectView {
    const seen: Record<NodeKind, number> = { terminal: 0, chat: 0, file: 0 };
    const nodes = kinds.map((kind, index): ProjectNode => {
        const nth = seen[kind]++;
        const id = nodeId(variant, kind, nth);
        const title = `${kind[0]!.toUpperCase()}${kind.slice(1)} ${nth + 1}`;
        if (kind === 'file') {
            return { id, kind, title: files[nth]!.path.split('/').pop()!, path: files[nth]!.path, ...placed(index) };
        }
        return { id, kind, title, ...placed(index) };
    });
    return { kind: 'canvas', id: CANVAS_ID, name: 'Canvas', nodes, texts: [], edges: [], layouts: [] };
}

/* Kinds taken in turn, so every row of the canvas holds some of each. */
function interleaved(counts: Record<NodeKind, number>): NodeKind[] {
    const left = { ...counts };
    const kinds: NodeKind[] = [];
    while (left.terminal + left.chat + left.file > 0) {
        for (const kind of ['terminal', 'chat', 'file'] as const) {
            if (left[kind] > 0) {
                kinds.push(kind);
                left[kind] -= 1;
            }
        }
    }
    return kinds;
}

function gridScene(): MeasureScene {
    const files = [0, 1, 2].map((index) => fixtureFile(index, SMALL_FILE_BLOCKS));
    const views: ProjectView[] = [];
    const grid: string[][] = [[], [], []];
    for (let index = 0; index < 3; index++) {
        const terminal = nodeId('grid', 'terminal', index);
        const chat = nodeId('grid', 'chat', index);
        const file = nodeId('grid', 'file', index);
        views.push(
            { kind: 'terminal', id: terminal, name: `Terminal ${index + 1}`, node: {} },
            { kind: 'chat', id: chat, name: `Chat ${index + 1}`, node: {} },
            { kind: 'file', id: file, name: files[index]!.path.split('/').pop()!, path: files[index]!.path }
        );
        grid[index] = [terminal, chat, file];
    }
    return { variant: 'grid', content: { name: NAMES.grid, color: '#5b8def', views }, files, grid, nodes: { terminal: 3, chat: 3, file: 3 } };
}

export function measureScene(variant: MeasureVariant): MeasureScene {
    if (variant === 'grid') {
        return gridScene();
    }
    const counts: Record<NodeKind, number> = {
        scene: { terminal: 10, chat: 10, file: 10 },
        files: { terminal: 0, chat: 0, file: 10 },
        chats: { terminal: 0, chat: 100, file: 0 },
        terminals: { terminal: 16, chat: 0, file: 0 }
    }[variant];
    const blocks = variant === 'files' ? LARGE_FILE_BLOCKS : SMALL_FILE_BLOCKS;
    const files = Array.from({ length: counts.file }, (_, index) => fixtureFile(index, blocks));
    const canvas = canvasOf(variant, interleaved(counts), files);
    return { variant, content: { name: NAMES[variant], color: '#5b8def', views: [canvas] }, files, grid: null, nodes: counts };
}

/* What a report says about the fixture: how many of each and how large the files are. */
export function sceneFacts(scene: MeasureScene): {
    variant: MeasureVariant;
    nodes: Record<string, number>;
    files: number;
    fileBytes: number;
    fileLines: number;
} {
    const nodes = Object.fromEntries(Object.entries(scene.nodes).filter(([, count]) => count > 0));
    const encoder = new TextEncoder();
    return {
        variant: scene.variant,
        nodes,
        files: scene.files.length,
        fileBytes: scene.files.reduce((sum, file) => sum + encoder.encode(file.text).length, 0),
        fileLines: scene.files.reduce((sum, file) => sum + file.text.split('\n').length, 0)
    };
}
