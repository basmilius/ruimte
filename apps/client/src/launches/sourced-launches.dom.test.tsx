import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { LaunchesDocument } from '@ruimte/contracts';
import { act } from 'react';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { buttonWithText, everything } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
const PROJECT_ID = 'project-atlas';
const WEB = 'dev.harbor:compose:web';
const SOURCE = { extension: 'dev.harbor', id: 'compose', title: 'Harbor' };
const HELD = { launchId: WEB, command: "sh -c 'bun run dev'", cwd: '/work/atlas', env: { HARBOR_SERVICE: 'web' }, source: SOURCE };
const DOCUMENT: LaunchesDocument = {
    rev: 1,
    launches: [{ id: 'tests', name: 'Tests', kind: 'task', command: 'bun test', shared: false }],
    approved: ['tests'],
    sourced: [
        { id: WEB, name: 'web', kind: 'service', command: "sh -c 'bun run dev'", url: 'http://localhost:5173', source: SOURCE },
        { id: 'dev.harbor:compose:api', name: 'api', kind: 'service', command: "sh -c 'bun run api'", source: SOURCE }
    ]
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let approved: boolean;

beforeEach(async () => {
    machine = new FakeMachine();
    approved = false;
    machine.answer('launches.read', () => DOCUMENT);
    machine.answer('launches.approveSource', () => {
        approved = true;

        return {};
    });
    machine.answer('launch.start', () => (approved ? { outcome: 'started' as const } : { outcome: 'held' as const, held: [HELD] }));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setPanel({ open: true, kind: 'launches' }));
});

afterEach(async () => {
    await act(async () => useUi.getState().setPanel({ open: false, kind: 'launches' }));
    await page.unmount();
    workspace.close();
});

async function openMenu(): Promise<void> {
    await clickOn(document.querySelector('button[aria-label="Launches"]'));
    await until(() => everything().includes('From Harbor'));
}

describe('the launches an extension lists', () => {
    test('show in the menu under their source, beside the launches of the project, with nothing to edit', async () => {
        await until(() => document.querySelector('button[aria-label="Launches"]') !== null);
        await openMenu();

        expect(document.querySelector('[aria-label="web"]')).not.toBeNull();
        expect(document.querySelector('[aria-label="api"]')).not.toBeNull();
        expect(document.querySelector('[aria-label="Edit Tests"]')).not.toBeNull();
        expect(document.querySelector('[aria-label="Edit web"]')).toBeNull();
        expect(document.querySelector('[aria-label="Launch web"]')).not.toBeNull();
    });

    test('ask a person before the first start, who approves everything of the source at once', async () => {
        await until(() => document.querySelector('button[aria-label="Launches"]') !== null);
        await openMenu();
        await clickOn(document.querySelector('[aria-label="Launch web"]'));
        await until(() => everything().includes('Run a command from Harbor?'));

        expect(everything()).toContain("sh -c 'bun run dev'");
        expect(everything()).toContain('HARBOR_SERVICE=');
        expect(everything()).toContain('asks again when that file changes');

        await clickOn(buttonWithText('Approve all from Harbor'));
        await until(() => machine.requests('launch.start').length === 2);

        expect(machine.requests('launches.approveSource')).toEqual([{ projectId: PROJECT_ID, extension: 'dev.harbor', source: 'compose' }]);
        expect(machine.requests('launch.start')).toEqual([
            { projectId: PROJECT_ID, launchId: WEB },
            { projectId: PROJECT_ID, launchId: WEB, replace: false }
        ]);
    });

    test('say where they come from above their output', async () => {
        await until(() => document.querySelector('button[aria-label="Launches"]') !== null);
        await openMenu();
        await clickOn(document.querySelector('[aria-label="web"] [role="menuitem"]') ?? document.querySelector('[aria-label="web"]'));
        await until(() => everything().includes('web has not run since the machine started.'));

        expect(everything()).toContain('From Harbor');
        expect(everything()).toContain("sh -c 'bun run dev'");
    });
});
