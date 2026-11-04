import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectLocal } from '@ruimte/contracts';
import { mount, until, type Mounted } from '../../testing/dom';
import { installDesktop, removeDesktop } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
const OTHER = emptyCanvas('other', 'Other');

let workspace: FakeWorkspace;
let page: Mounted;

async function open(layout?: ProjectLocal['layout']): Promise<void> {
    localStorage.clear();
    installDesktop();
    workspace = await openFakeWorkspace(new FakeMachine(), { views: [MAIN, OTHER] }, { activeViewId: MAIN.id, views: {}, layout });
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector('[data-cell-bar]') !== null);
}

function topRow(): HTMLElement | null {
    return page.host.querySelector<HTMLElement>('header.workspace-toolbar');
}

function rail(): HTMLElement | null {
    return page.host.querySelector<HTMLElement>('nav[aria-label="Tools"]');
}

afterEach(async () => {
    await page.unmount();
    workspace.close();
    removeDesktop();
});

describe('the shell', () => {
    test('puts the tools in the rail, with Settings out of the sidebar', async () => {
        await open();

        expect(rail()?.querySelector('button[aria-label="Search"]')).not.toBeNull();
        expect(rail()?.querySelector('button[aria-label="Files"]')).not.toBeNull();
        expect(rail()?.querySelector('button[aria-label="Settings"]')).not.toBeNull();
        expect(topRow()?.querySelector('button[aria-label="Search"]')).toBeNull();
        expect(page.host.querySelector('aside button[aria-label="Settings"]')).toBeNull();
    });

    test('gives the bar of the only cell to the top row, beside the project', async () => {
        await open();

        expect(topRow()?.querySelector('[data-cell-bar]')?.textContent).toContain('Main');
        expect(page.host.querySelector('[data-split-cell] [data-cell-bar]')).toBeNull();
    });

    test('leaves every cell of a split its own bar', async () => {
        await open({
            columns: [
                { size: 0.5, cells: [{ viewId: MAIN.id, size: 1 }] },
                { size: 0.5, cells: [{ viewId: OTHER.id, size: 1 }] }
            ],
            focus: { column: 0, cell: 0 }
        });

        expect(topRow()?.querySelector('[data-cell-bar]')).toBeNull();
        expect(page.host.querySelectorAll('[data-split-cell] [data-cell-bar]')).toHaveLength(2);
    });
});
