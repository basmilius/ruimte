import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
const HARBOR = { extension: 'dev.harbor', id: 'service-shell', title: 'Harbor shell' };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

beforeEach(async () => {
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('extension.terminalProfiles', () => ({ profiles: [HARBOR] }));
    machine.answer('extension.terminalOpen', () => ({ nodeId: 'terminal-made' }));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

function menuItem(text: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menu"] [role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.trim() === text) ?? null;
}

async function openCanvasMenu(): Promise<void> {
    await until(() => page.host.querySelector('[data-canvas-surface]') !== null);
    await act(async () => {
        page.host
            .querySelector('[data-canvas-surface]')
            ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 300, button: 2 }));
    });
}

async function openNewViewMenu(): Promise<void> {
    await clickOn(([...page.host.querySelectorAll('button')] as HTMLElement[]).find((button) => button.textContent?.trim() === 'New view') ?? null);
}

describe('a terminal profile of an extension', () => {
    test('is a row where a person adds a terminal to a canvas, and the machine makes the terminal there', async () => {
        await openCanvasMenu();
        await until(() => menuItem('Harbor shell') !== null);
        await clickOn(menuItem('Harbor shell'));
        await until(() => machine.requests('extension.terminalOpen').length === 1);

        expect(machine.requests('extension.terminalOpen')[0]).toMatchObject({
            id: 'dev.harbor',
            profile: 'service-shell',
            picked: true,
            title: 'Harbor shell',
            viewId: MAIN.id,
            at: { x: expect.any(Number), y: expect.any(Number) }
        });
    });

    test('is a row where a person makes a new view, which names no canvas', async () => {
        await openNewViewMenu();
        await until(() => menuItem('Harbor shell') !== null);
        await clickOn(menuItem('Harbor shell'));
        await until(() => machine.requests('extension.terminalOpen').length === 1);

        const [asked] = machine.requests('extension.terminalOpen');

        expect(asked).toMatchObject({ id: 'dev.harbor', profile: 'service-shell', picked: true });
        expect(asked?.viewId).toBeUndefined();
    });

    test('tells the person why it did not open', async () => {
        machine.answer('extension.terminalOpen', () => {
            throw Object.assign(new Error('dev.harbor is turned off'), { code: 'unavailable' });
        });
        await openNewViewMenu();
        await until(() => menuItem('Harbor shell') !== null);
        await clickOn(menuItem('Harbor shell'));
        await until(() => document.body.textContent?.includes('Harbor shell did not open') === true);

        expect(document.body.textContent).toContain('dev.harbor is turned off');
    });

    test('is on no menu of a machine that lists none', async () => {
        machine.answer('extension.terminalProfiles', () => ({ profiles: [] }));
        await openNewViewMenu();
        await until(() => menuItem('Terminal') !== null);
        // A row the machine listed before stays until its answer, so the menu never jumps while it opens.
        await until(() => machine.requests('extension.terminalProfiles').length > 0 && menuItem('Harbor shell') === null);

        expect(menuItem('Terminal')).not.toBeNull();
    });
});
