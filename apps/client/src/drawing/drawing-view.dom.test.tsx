import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isApplePlatform } from '@adecore/ui';
import type { DrawingDocument, ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { renamingView } from '@/project/dialogs';
import { liveDrawing } from '@/state/drawing';
import { clickOn, mount, pressKey, until, type Mounted } from '../../testing/dom';
import { menuItem } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const SKETCH: ProjectView = { kind: 'drawing', id: 'drawing-sketch', name: 'Sketch' };
const DRAWN: DrawingDocument = {
    version: 1,
    rev: 3,
    elements: [{ kind: 'rect', id: 'box', x: 0, y: 0, w: 100, h: 60, stroke: 'ink', strokeWidth: 2, seed: 1 }]
} as DrawingDocument;
const EMPTY_HINT = 'Nothing drawn yet';

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('drawing.open', () => ({ document: DRAWN }));
    machine.answer('drawing.save', ({ baseRev }) => ({ rev: baseRev + 1 }));
    workspace = await openFakeWorkspace(machine, { views: [SKETCH] }, { activeViewId: SKETCH.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    renamingView.set(null);
    await page.unmount();
    workspace.close();
});

describe('a drawing view', () => {
    test('opens the drawing it names and draws it without the hint for an empty one', async () => {
        await until(() => machine.requests('drawing.open').length > 0);
        expect(machine.requests('drawing.open')[0]).toEqual({ projectId: 'project-atlas', viewId: SKETCH.id });
        await until(() => page.host.querySelector('canvas') !== null);
        expect(page.host.textContent).not.toContain(EMPTY_HINT);
    });

    test('a drawing emptied with select all and Delete shows the hint and saves over the rev it read', async () => {
        await until(() => page.host.querySelector('canvas') !== null && machine.requests('drawing.open').length > 0);
        const apple = isApplePlatform();
        await pressKey(document.body, 'a', { metaKey: apple, ctrlKey: !apple });
        await pressKey(document.body, 'Delete');
        await until(() => page.host.textContent?.includes(EMPTY_HINT) === true);

        // Leaving the window writes what is pending at once, instead of after the save delay.
        await act(async () => {
            window.dispatchEvent(new Event('beforeunload'));
        });
        await until(() => machine.requests('drawing.save').length > 0);
        expect(machine.requests('drawing.save')[0]).toEqual({ projectId: 'project-atlas', viewId: SKETCH.id, baseRev: 3, content: { elements: [] } });
    });

    test('a rename that hangs in the sidebar leaves the tool keys to the drawing', async () => {
        await until(() => page.host.querySelector('canvas') !== null && liveDrawing(SKETCH.id) !== null);
        await act(async () => renamingView.set('heading-1'));
        await pressKey(document.body, 'r');

        expect(liveDrawing(SKETCH.id)?.tool).toBe('rect');
    });

    test('offers the text sizes up to 96 px in the style menu, and keeps the size picked for what is written next', async () => {
        await until(() => page.host.querySelector('canvas') !== null && liveDrawing(SKETCH.id) !== null);
        await clickOn(page.host.querySelector('button[aria-label="Style"]'));
        await until(() => menuItem('96 px', 'menuitemradio') !== null);
        const sizes = [...document.querySelectorAll('[role="menuitemradio"]')].map((row) => row.textContent?.trim()).filter((label) => label?.endsWith(' px'));

        expect(sizes).toEqual(['16 px', '20 px', '28 px', '36 px', '48 px', '64 px', '96 px']);

        await clickOn(menuItem('96 px', 'menuitemradio'));

        expect(liveDrawing(SKETCH.id)?.style.textSize).toBe(96);
    });

    test('a change the machine announces is drawn in place of what was there', async () => {
        await until(() => page.host.querySelector('canvas') !== null && machine.requests('drawing.open').length > 0);
        await act(async () => {
            machine.emit('drawing.changed', { projectId: 'project-atlas', viewId: SKETCH.id, document: { ...DRAWN, rev: 4, elements: [] } });
        });
        await until(() => page.host.textContent?.includes(EMPTY_HINT) === true);
        expect(machine.requests('drawing.save')).toEqual([]);
    });
});
