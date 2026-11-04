import { Glob } from 'bun';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { ProjectCanvasView, ProjectView } from '@ruimte/contracts';
import { parseSync, Visitor } from 'oxc-parser';
import { nodeRefsOfView, nodesOfView, projectNodes } from '@/project/view-nodes';
import { defaultCanvases } from '@/state/canvas';
import { useDocument } from '@/state/document';

/*
 * The files that read the nodes of a view from the document itself: the one reader, the file layer
 * that loads and writes the document, and the sidebar's own rows, whose `nodes` are no view's.
 */
const READS_THE_DOCUMENT: Record<string, string> = {
    'project/view-nodes.ts': 'the one reader',
    'project/merge.ts': 'merges three versions of the document',
    'state/canvas-content-slice.ts': 'loads a view into its editor',
    'state/document-model.ts': 'renames a node in the document',
    'state/document-nodes-slice.ts': 'moves a node between views of the document',
    'actions/view-actions.ts': 'an undo holds the exported copy it checks against',
    'shell/sidebar-rows.ts': 'the nodes of a sidebar row, which are no view',
    'shell/sidebar-groups.ts': 'the nodes of a sidebar row, which are no view',
    'shell/SidebarListRows.tsx': 'the nodes of a sidebar row, which are no view'
};

const SOURCE = join(import.meta.dir, '..');

/* `.nodes` read off something named like a view, or off something the file narrows to a canvas view. */
function viewNodeReads(path: string): number[] {
    const text = readFileSync(join(SOURCE, path), 'utf8');
    const narrowed = new Set([...text.matchAll(/isCanvasView\((\w+)\)|(\w+)\.kind === 'canvas'/g)].map((match) => match[1] ?? match[2]!));
    const lines: number[] = [];
    new Visitor({
        MemberExpression(node) {
            if (node.computed || node.property.type !== 'Identifier' || node.property.name !== 'nodes' || node.object.type !== 'Identifier') {
                return;
            }
            if (/view/i.test(node.object.name) || narrowed.has(node.object.name)) {
                lines.push(text.slice(0, node.start).split('\n').length);
            }
        }
    }).visit(parseSync(path, text).program);
    return lines;
}

function canvas(id: string, nodeIds: string[]): ProjectCanvasView {
    return {
        kind: 'canvas',
        id,
        name: id,
        nodes: nodeIds.map((nodeId) => ({ id: nodeId, kind: 'note', title: nodeId, x: 0, y: 0, w: 100, h: 80 })),
        texts: [],
        edges: [],
        layouts: []
    };
}

beforeEach(() => {
    defaultCanvases.keep([]);
});

afterEach(() => {
    defaultCanvases.keep([]);
});

describe('nodesOfView', () => {
    test('is the document for a canvas that is not on screen', () => {
        const view = canvas('main', ['a']);
        expect(nodesOfView(view)).toBe(view.nodes);
    });

    test('is the editor for a canvas on screen, in its order, and the same list until a node changes', () => {
        const saved = canvas('main', ['a']);
        const editor = defaultCanvases.of('main');
        editor.getState().loadView(canvas('main', ['b', 'a']), null);
        const first = nodesOfView(saved);
        expect(first.map((node) => node.id)).toEqual(['b', 'a']);
        editor.setState({ selection: ['a'] });
        expect(nodesOfView(saved)).toBe(first);
        editor.getState().renameNode('a', 'Renamed');
        expect(nodesOfView(saved).map((node) => node.title)).toEqual(['b', 'Renamed']);
    });

    test('is the document while an editor made for the view has not loaded it yet', () => {
        const view = canvas('main', ['a']);
        defaultCanvases.of('main');
        expect(nodesOfView(view)).toBe(view.nodes);
    });

    test('is empty for a view that is no canvas', () => {
        expect(nodesOfView({ kind: 'chat', id: 'chat', name: 'Chat', node: {} } as ProjectView)).toEqual([]);
    });
});

describe('nodeRefsOfView', () => {
    test('counts a session view as the one node it is', () => {
        expect(nodeRefsOfView({ kind: 'terminal', id: 'term', name: 'Shell', node: {} } as ProjectView)).toEqual([
            { id: 'term', kind: 'terminal', title: 'Shell' }
        ]);
    });
});

describe('projectNodes', () => {
    test('leaves out the nodes of a canvas another machine draws here', () => {
        const peer = { ...canvas('peer', ['theirs']), hidden: true } as ProjectCanvasView;
        useDocument.setState({ views: [canvas('main', ['mine']), peer] } as never);
        expect(projectNodes().map((node) => node.id)).toEqual(['mine']);
        useDocument.setState({ views: [] } as never);
    });
});

describe('reading the nodes of a view', () => {
    const files = [...new Glob('**/*.{ts,tsx}').scanSync(SOURCE)]
        .map((path) => path.split(sep).join('/'))
        .filter((path) => !/\.test\.tsx?$/.test(path))
        .sort();

    test('goes through nodesOfView outside the files that load and write the document', () => {
        const direct = files.flatMap((path) => {
            if (READS_THE_DOCUMENT[path] !== undefined) {
                return [];
            }
            return viewNodeReads(path).map((line) => `${path}:${line}`);
        });
        expect(direct).toEqual([]);
    });

    test('leaves no file on the list that no longer reads the document', () => {
        const idle = Object.keys(READS_THE_DOCUMENT).filter((path) => viewNodeReads(path).length === 0);
        expect(idle).toEqual([]);
    });
});
