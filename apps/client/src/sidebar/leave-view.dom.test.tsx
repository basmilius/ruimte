import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { useDocument } from '@/state/document';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const views: ProjectView[] = [
    { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] },
    { kind: 'file', id: 'readme', name: 'Readme', path: 'README.md' }
];
let workspace: FakeWorkspace;
let page: Mounted;

function row(): HTMLElement | null {
    return [...page.host.querySelectorAll<HTMLElement>('[data-sidebar-row]')].find((entry) => entry.dataset.sidebarRow?.endsWith('view:readme')) ?? null;
}

beforeEach(async () => {
    workspace = await openFakeWorkspace(new FakeMachine(), { views }, { activeViewId: 'readme', views: {} });
    page = mount();
    await page.renderApp();
    await until(() => row() !== null);
});

afterEach(async () => {
    await page?.unmount();
    workspace?.close();
});

test('Escape in the body of a view of its own puts the keyboard on its row in the sidebar', async () => {
    await act(async () => useDocument.getState().setBodyFocused(true));

    await pressKey(document.body, 'Escape');

    expect(useDocument.getState().bodyFocused).toBe(false);
    expect(document.activeElement).toBe(row());
});
