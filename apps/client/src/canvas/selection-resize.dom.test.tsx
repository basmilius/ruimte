import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { GROUP_HEADER, GROUP_PADDING, type ProjectCanvasView, type ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { liveCanvas } from '@/state/canvas';
import { windowWorkspace } from '@/workspace/window';
import { openCanvasPage, savedNodes, type CanvasPage } from '../../testing/canvas-page';
import { until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';

const GAP = 40;
const WIDTH = 320;
// Away from the middle of the edge, which belongs to the port there.
const HANDLE_Y = 40;

function note(id: string, x: number, y: number): ProjectNode {
    return { id, kind: 'note', title: id, body: id, x, y, w: WIDTH, h: 240 };
}

// A row of three notes in a group that fits them, and one note below that stands on its own.
const ROW = [note('a', 0, 0), note('b', WIDTH + GAP, 0), note('c', 2 * (WIDTH + GAP), 0)];
const FRAME: ProjectNode = {
    id: 'frame',
    kind: 'group',
    title: 'Row',
    x: -GROUP_PADDING,
    y: -GROUP_PADDING - GROUP_HEADER,
    w: 3 * WIDTH + 2 * GAP + 2 * GROUP_PADDING,
    h: 240 + 2 * GROUP_PADDING + GROUP_HEADER,
    memberIds: ['a', 'b', 'c']
};
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [FRAME, ...ROW, note('alone', 0, 800)], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let canvas: CanvasPage;

function at(type: string, x: number, y: number, modifiers: PointerEventInit = {}): PointerEvent {
    return new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y, ...modifiers });
}

/* Drags the handle on the right edge of `a` by `dx`, the camera being at the origin. */
async function dragRightEdge(dx: number): Promise<void> {
    const surface = canvas.page.host.querySelector('[data-canvas-surface]')!;
    const edge = WIDTH + 6;

    await act(async () => {
        surface.dispatchEvent(at('pointermove', edge, HANDLE_Y));
    });
    await until(() => canvas.page.host.querySelector('[data-resize-node="a"][data-resize="e"]') !== null);
    await act(async () => {
        canvas.page.host.querySelector('[data-resize-node="a"][data-resize="e"]')!.dispatchEvent(at('pointerdown', edge, HANDLE_Y));
        surface.dispatchEvent(at('pointermove', edge + dx, HANDLE_Y));
        surface.dispatchEvent(at('pointerup', edge + dx, HANDLE_Y));
    });
}

function frames(ids: string[]): number[][] {
    const nodes = liveCanvas('main')!.nodes;

    return ids.map((id) => [nodes[id]!.x, nodes[id]!.w]);
}

beforeEach(async () => {
    machine = new FakeMachine();
    canvas = await openCanvasPage(machine, [MAIN], 'a');
    await act(async () => {
        liveCanvas('main')!.setViewport({ w: 1600, h: 1200 });
        liveCanvas('main')!.setCamera({ x: 0, y: 0, zoom: 1 });
    });
});

afterEach(() => canvas.close());

describe('one handle on a selection of nodes', () => {
    test('gives every selected node that size, keeps the room between them, grows their group and undoes as one change', async () => {
        await act(async () => liveCanvas('main')!.select(['a', 'b', 'c']));
        await dragRightEdge(80);

        expect(frames(['a', 'b', 'c'])).toEqual([
            [0, 400],
            [400 + GAP, 400],
            [2 * (400 + GAP), 400]
        ]);
        expect(canvas.page.host.querySelector<HTMLElement>('[data-node-id="c"]')!.style.width).toBe('400px');
        expect(frames(['alone'])).toEqual([[0, WIDTH]]);
        // The group holds the wider row with its own room on the right.
        expect(liveCanvas('main')!.nodes.frame).toMatchObject({ x: -GROUP_PADDING, w: 3 * 400 + 2 * GAP + 2 * GROUP_PADDING });

        await act(async () => windowWorkspace()!.connection.projects.flush());
        await until(() => savedNodes(machine).find((node) => node.id === 'c')?.w === 400);
        expect(savedNodes(machine).find((node) => node.id === 'c')).toMatchObject({ x: 2 * (400 + GAP), w: 400 });

        await act(async () => liveCanvas('main')!.undo());
        expect(frames(['a', 'b', 'c'])).toEqual(ROW.map((node) => [node.x, node.w]));
        expect(liveCanvas('main')!.nodes.frame!.w).toBe(FRAME.w);
    });

    test('resizes only the node under the handle when it is not one of the selected nodes', async () => {
        await act(async () => liveCanvas('main')!.select(['b', 'c']));
        await dragRightEdge(80);

        expect(frames(['a', 'b', 'c'])).toEqual([
            [0, 400],
            [WIDTH + GAP, WIDTH],
            [2 * (WIDTH + GAP), WIDTH]
        ]);
    });
});
