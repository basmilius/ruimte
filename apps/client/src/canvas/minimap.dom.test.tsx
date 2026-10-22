import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { visibleRect } from '@/canvas/math';
import { minimapScale, minimapWorld, rectOnMap } from '@/canvas/minimap-geometry';
import { canvasOfNode } from '@/state/canvas';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const PLAN: ProjectNode = { id: 'plan', kind: 'note', title: 'Plan', body: 'Ship it', x: 0, y: 0, w: 400, h: 320 };
const FAR: ProjectNode = { id: 'far', kind: 'note', title: 'Far away', body: 'Out of sight', x: 2000, y: 1000, w: 400, h: 320 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [PLAN, FAR], texts: [], edges: [], layouts: [] };
const VIEWPORT = { w: 1280, h: 800 };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function theMap(): SVGSVGElement | null {
    return document.querySelector('svg[role="img"][aria-label="Canvas map"]');
}

function mapSwitch(): HTMLElement | null {
    return document.querySelector('[role="switch"][aria-label="Canvas map"]');
}

function canvas() {
    return canvasOfNode(PLAN.id)!;
}

async function open(): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-node-id="${PLAN.id}"]`) !== null);
    // The page has no layout to measure, so the canvas gets the size a window would give it.
    await act(async () => {
        canvas().getState().setViewport(VIEWPORT);
        canvas().getState().setCamera({ x: 0, y: 0, zoom: 1 });
    });
}

beforeEach(() => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    workspace.close();
    useSettings.getState().update({ canvasMinimap: false });
});

describe('the map of a canvas', () => {
    test('stays away until a person turns it on in Settings, Views, and goes again when they turn it off', async () => {
        await open();
        expect(theMap()).toBeNull();

        await act(async () => useUi.getState().setSettings({ open: true, section: 'views' }));
        await until(() => mapSwitch() !== null);
        expect(mapSwitch()?.getAttribute('aria-checked')).toBe('false');

        await clickOn(mapSwitch());
        await until(() => theMap() !== null);
        expect(mapSwitch()?.getAttribute('aria-checked')).toBe('true');
        expect([...theMap()!.querySelectorAll('[data-minimap-node]')].map((rect) => rect.getAttribute('data-minimap-node')).sort()).toEqual([FAR.id, PLAN.id]);

        await clickOn(mapSwitch());
        await until(() => theMap() === null);
    });

    test('a click on a spot of the map brings it to the middle of the view at the zoom it had', async () => {
        useSettings.getState().update({ canvasMinimap: true });
        await open();
        await until(() => theMap() !== null);
        const camera = canvas().getState().camera;
        const scale = minimapScale(minimapWorld({ x: 0, y: 0, w: 2400, h: 1320 }, visibleRect(camera, VIEWPORT)));
        const far = rectOnMap(scale, FAR);

        await act(async () => {
            const map = theMap()!;
            const at = { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: far.x + far.w / 2, clientY: far.y + far.h / 2 };
            map.dispatchEvent(new PointerEvent('pointerdown', at));
            map.dispatchEvent(new PointerEvent('pointerup', at));
        });

        const after = canvas().getState().camera;
        expect(after.zoom).toBe(1);
        expect(VIEWPORT.w / 2 - after.x).toBeCloseTo(FAR.x + FAR.w / 2);
        expect(VIEWPORT.h / 2 - after.y).toBeCloseTo(FAR.y + FAR.h / 2);
        // The press stayed on the map: nothing on the canvas was selected or boxed by it.
        expect(canvas().getState().selection).toEqual([]);
        expect(canvas().getState().panning).toBe(false);
    });

    test('a drag the map leaves halfway, when it goes, stops panning the canvas', async () => {
        useSettings.getState().update({ canvasMinimap: true });
        await open();
        await until(() => theMap() !== null);

        await act(async () => {
            theMap()!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: 20, clientY: 20 }));
        });
        expect(canvas().getState().panning).toBe(true);

        await act(async () => useSettings.getState().update({ canvasMinimap: false }));
        await until(() => theMap() === null);
        expect(canvas().getState().panning).toBe(false);
    });
});
