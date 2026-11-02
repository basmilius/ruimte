import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView } from '@ruimte/contracts';
import { onClientEvent } from '@/extensions/client-events';
import { focusedCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { FakeMachine } from '../../testing/fake-machine';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';

const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };
const OTHER: ProjectCanvasView = { ...MAIN, id: 'other', name: 'Other' };
let canvas: CanvasPage;

beforeEach(async () => {
    canvas = await openCanvasPage(new FakeMachine(), [MAIN, OTHER], (host) => host.querySelector('[data-canvas-surface]') !== null);
});

afterEach(() => canvas.close());

test('follows the canvas that has the focus when the focus moves to another cell of the grid', async () => {
    const added: string[] = [];
    const stop = onClientEvent('node.added', ({ node }) => {
        added.push(node.id);
    });

    await act(async () =>
        useDocument.setState({
            layout: {
                columns: [
                    { size: 0.5, cells: [{ viewId: MAIN.id, size: 1 }] },
                    { size: 0.5, cells: [{ viewId: OTHER.id, size: 1 }] }
                ],
                focus: { column: 0, cell: 0 }
            }
        })
    );
    await act(async () => useDocument.getState().focusTowards('right'));

    const nodeId = await act(async () => focusedCanvas().getState().addNode('note', { x: 0, y: 0 }));

    stop();

    expect(focusedCanvas().getState().viewId).toBe(OTHER.id);
    expect(added).toEqual([nodeId as string]);
});
