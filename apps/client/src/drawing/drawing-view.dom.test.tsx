import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DrawingDocument, ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { isApplePlatform } from '@/desktop/bridge';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const SKETCH: ProjectView = { kind: 'drawing', id: 'drawing-sketch', name: 'Sketch' };
const DRAWN: DrawingDocument = {
    version: 1,
    rev: 3,
    elements: [{ kind: 'rect', id: 'box', x: 0, y: 0, w: 100, h: 60, stroke: 'ink', strokeWidth: 2, seed: 1 }]
} as DrawingDocument;
const EMPTY_HINT = 'Nothing drawn yet.';

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

    test('a change the machine announces is drawn in place of what was there', async () => {
        await until(() => page.host.querySelector('canvas') !== null && machine.requests('drawing.open').length > 0);
        await act(async () => {
            machine.emit('drawing.changed', { projectId: 'project-atlas', viewId: SKETCH.id, document: { ...DRAWN, rev: 4, elements: [] } });
        });
        await until(() => page.host.textContent?.includes(EMPTY_HINT) === true);
        expect(machine.requests('drawing.save')).toEqual([]);
    });
});
