import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { act } from 'react';
import { useInstalledExtensions } from '@/extensions/loader';
import { mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
const DRAWN: ProjectView = { kind: 'chat', id: 'drawn', name: 'Kept work', node: {}, drawnBy: 'acme.chat' };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function extension(enabled: boolean): InstalledClientExtension {
    return {
        manifest: { id: 'acme.chat', name: 'Acme chat', version: '1.0.0', api: 1 },
        base: '/__extensions/acme.chat/x/',
        enabled,
        hasClient: true,
        dev: false
    };
}

function row(): HTMLElement | null {
    return page.host.querySelector<HTMLElement>(`[data-sidebar-row="view:${DRAWN.id}"]`);
}

/* What the loader writes once the shell listed this computer's extensions. */
function listed(installed: InstalledClientExtension[]): void {
    act(() => useInstalledExtensions.setState({ installed, listed: true }));
}

beforeEach(async () => {
    // Another file may have left the list of a computer behind; each test starts before one came.
    useInstalledExtensions.setState({ installed: [], failures: {}, listed: false });
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [MAIN, DRAWN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    useInstalledExtensions.setState({ installed: [], failures: {}, listed: false });
});

describe('a chat an extension draws itself', () => {
    test('stays out of the sidebar while its extension is on, also before the list of extensions came', async () => {
        await page.renderApp();
        await until(() => page.host.querySelector(`[data-sidebar-row="view:${MAIN.id}"]`) !== null);
        expect(row()).toBeNull();

        listed([extension(true)]);
        expect(row()).toBeNull();
    });

    test('is listed like any other chat once its extension is turned off, and leaves again when it is back on', async () => {
        await page.renderApp();
        listed([extension(false)]);
        await until(() => row() !== null);
        expect(row()!.textContent).toContain('Kept work');

        listed([extension(true)]);
        await until(() => row() === null);
    });

    test('is listed while its extension failed to load, and leaves again once a load succeeds', async () => {
        await page.renderApp();
        listed([extension(true)]);
        act(() => useInstalledExtensions.setState({ failures: { 'acme.chat': 'Failed to fetch dynamically imported module' } }));
        await until(() => row() !== null);
        expect(row()!.textContent).toContain('Kept work');

        act(() => useInstalledExtensions.setState({ failures: {} }));
        await until(() => row() === null);
    });

    test('is listed once its extension is removed, so what was said in it stays in reach', async () => {
        await page.renderApp();
        listed([]);
        await until(() => row() !== null);
        expect(row()!.textContent).toContain('Kept work');
    });
});
