import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { isApplePlatform } from '@adecore/ui';
import type { ProjectCanvasView } from '@ruimte/contracts';
import { act } from 'react';
import { browserRegistry } from '@/clients/browser/registry';
import { focusedCanvas } from '@/state/canvas';
import { mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const VIEW: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [{ id: 'page', kind: 'browser', title: 'Docs', x: 0, y: 0, w: 640, h: 420 }],
    texts: [],
    edges: [],
    layouts: []
};
const MOD = isApplePlatform() ? { metaKey: true } : { ctrlKey: true };

let workspace: FakeWorkspace;
let page: Mounted;
let steps: string[];
let restores: Array<() => void>;

beforeEach(async () => {
    steps = [];
    const back = spyOn(browserRegistry, 'back').mockImplementation((key) => void steps.push(`back ${key}`));
    const forward = spyOn(browserRegistry, 'forward').mockImplementation((key) => void steps.push(`forward ${key}`));
    restores = [() => back.mockRestore(), () => forward.mockRestore()];
    workspace = await openFakeWorkspace(new FakeMachine(), { views: [VIEW] }, { activeViewId: VIEW.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => focusedCanvas().getState().nodes.page !== undefined);
});

afterEach(async () => {
    await page?.unmount();
    workspace?.close();
    for (const restore of restores) {
        restore();
    }
});

async function pressBracket(key: '[' | ']'): Promise<KeyboardEvent> {
    const event = new KeyboardEvent('keydown', { key, code: key === '[' ? 'BracketLeft' : 'BracketRight', ...MOD, bubbles: true, cancelable: true });
    await act(async () => {
        document.body.dispatchEvent(event);
    });

    return event;
}

test('Mod+[ and Mod+] step the history of the focused page and leave the key alone without one', async () => {
    expect((await pressBracket('[')).defaultPrevented).toBe(false);
    expect(steps).toEqual([]);

    await act(async () => focusedCanvas().getState().setBodyFocus('page'));
    expect((await pressBracket('[')).defaultPrevented).toBe(true);
    await pressBracket(']');

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatch(/^back .*page/);
    expect(steps[1]).toMatch(/^forward .*page/);
});
