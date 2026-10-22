import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { canvasOfNode } from '@/state/canvas';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';

const NEAR: ProjectNode = { id: 'near', kind: 'note', title: 'Near', body: 'In sight', x: 0, y: 0, w: 320, h: 240 };
// More than a viewport past the right edge of a 1280 by 800 view at 100%.
const FAR: ProjectNode = { id: 'far', kind: 'note', title: 'Far away', body: 'Out of sight', x: 5000, y: 0, w: 320, h: 240 };
const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [NEAR, FAR],
    texts: [],
    edges: [{ id: 'line', from: NEAR.id, to: FAR.id }],
    layouts: []
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function frameOf(id: string): Element | null {
    return page.host.querySelector(`[data-node-id="${id}"]`);
}

function canvas() {
    return canvasOfNode(NEAR.id)!;
}

async function open(): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => frameOf(NEAR.id) !== null);
    // The page has no layout to measure, so the canvas gets the size a window would give it.
    await act(async () => {
        canvas().getState().setViewport({ w: 1280, h: 800 });
        canvas().getState().setCamera({ x: 0, y: 0, zoom: 1 });
    });
}

beforeEach(() => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('a note far from sight', () => {
    test('is left out of the page while its line is still drawn to it, and comes back once a pan nears it', async () => {
        await open();
        await until(() => frameOf(FAR.id) === null);
        expect(frameOf(NEAR.id)).not.toBeNull();
        // The line lands a gap short of the far note's left side, read off the node's geometry alone.
        const drawn = [...page.host.querySelectorAll('[data-edge-layer="lines"] path')].map((path) => path.getAttribute('d') ?? '');
        expect(drawn.some((d) => d.endsWith(`L ${FAR.x - 9} ${FAR.y + FAR.h / 2}`))).toBe(true);

        await act(async () => canvas().getState().setCamera({ x: -4000, y: 0, zoom: 1 }));
        await until(() => frameOf(FAR.id) !== null);
        expect(frameOf(FAR.id)?.textContent).toContain('Far away');
    });

    test('stays in the page while it is selected, the way a node an agent or a person acts on does', async () => {
        await open();
        await until(() => frameOf(FAR.id) === null);

        await act(async () => canvas().getState().select([FAR.id]));
        await until(() => frameOf(FAR.id) !== null);

        await act(async () => canvas().getState().clearSelection());
        await until(() => frameOf(FAR.id) === null);
    });
});
