import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { MachineCandidate } from '@ruimte/contracts';
import { act } from 'react';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { buttonWithText, everything, installDesktop, removeDesktop } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
const PROJECT_ID = 'project-atlas';
const TARGET = { projectId: PROJECT_ID, extension: 'dev.harbor', source: 'compose-machine', candidate: 'workbench' };
const WORKBENCH: MachineCandidate = {
    source: { extension: 'dev.harbor', id: 'compose-machine', title: 'Harbor' },
    id: 'workbench',
    title: 'workbench',
    place: 'harbor/workbench:1',
    running: false,
    state: 'idle',
    lines: []
};
const HELD: MachineCandidate = {
    ...WORKBENCH,
    state: 'held',
    lines: ['Reading harbor.yaml'],
    held: {
        digest: 'digest-1',
        programs: [
            { title: 'Start workbench', command: "sh -c 'sh scripts/start.sh'", cwd: '/work/atlas', env: { HARBOR_MACHINE: 'workbench' } },
            { login: true, command: "sh -c 'sh scripts/login.sh'", cwd: '/work/atlas' }
        ]
    }
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let candidates: MachineCandidate[];

function row(label: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('button')].find((element) => element.textContent?.includes(label)) ?? null;
}

function tell(candidate: MachineCandidate): Promise<void> {
    return act(async () => machine.emit('extension.machineChanged', { projectId: PROJECT_ID, candidate }));
}

/* The window as the app on the computer that runs the machine has it, unless the project is on another machine. */
async function open(thisMachine = true): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} }, {}, { thisMachine });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'machines' }));
}

beforeEach(() => {
    // The desktop app, which is the one client with a machine on its own computer.
    installDesktop();
    machine = new FakeMachine();
    candidates = [WORKBENCH];
    machine.answer('extension.machineList', () => ({ candidates }));
    machine.answer('extension.machineStart', ({ approve }) => ({ candidate: approve === undefined ? HELD : { ...WORKBENCH, state: 'starting' as const } }));
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    workspace.close();
    removeDesktop();
});

describe('Settings > Machines with a place an extension can start a machine in', () => {
    test('lists the place under its source, and its detail offers a start', async () => {
        await open();
        await until(() => everything().includes('From Harbor'));

        expect(machine.requests('extension.machineList')).toEqual([{ projectId: PROJECT_ID }]);

        await clickOn(row('workbench'));
        await until(() => everything().includes('Start a machine here'));

        expect(everything()).toContain('harbor/workbench:1, from Harbor');
        expect(everything()).toContain('You see what runs on this computer before anything starts.');
    });

    test('shows what would run and starts only after a yes, which names what was shown', async () => {
        await open();
        await until(() => row('workbench') !== null);
        await clickOn(row('workbench'));
        await clickOn(buttonWithText('Start'));
        await until(() => machine.requests('extension.machineStart').length === 1);
        await tell(HELD);
        await until(() => everything().includes('Run this on this computer?'));

        expect(machine.requests('extension.machineStart')).toEqual([TARGET]);
        expect(everything()).toContain("sh -c 'sh scripts/start.sh'");
        expect(everything()).toContain('Sign in on the new machine');
        expect(everything()).toContain('In /work/atlas');
        expect(everything()).toContain('Harbor read this from a file in this project.');
        expect(everything()).toContain('Waits for your approval');

        await clickOn(buttonWithText('Approve and start'));
        await until(() => machine.requests('extension.machineStart').length === 2);

        expect(machine.requests('extension.machineStart')[1]).toEqual({ ...TARGET, approve: 'digest-1' });
    });

    test('lets go of a held start on Cancel, and stops one under way', async () => {
        candidates = [HELD];
        await open();
        await until(() => row('workbench') !== null);
        await clickOn(row('workbench'));
        await clickOn(buttonWithText('Cancel'));
        await until(() => machine.requests('extension.machineStop').length === 1);
        await tell({ ...WORKBENCH, state: 'starting', lines: ['Start workbench', 'workbench is up'] });
        await until(() => everything().includes('Starting the machine'));

        expect(everything()).toContain('workbench is up');

        await clickOn(buttonWithText('Stop'));
        await until(() => machine.requests('extension.machineStop').length === 2);
        await tell({ ...WORKBENCH, state: 'stopped' });
        await until(() => everything().includes('Ruimte removed nothing the start had made.'));

        expect(machine.requests('extension.machineStop')).toEqual([TARGET, TARGET]);
    });

    test('brings the person to the sign-in of the new machine, with the page it named, and says when it runs', async () => {
        await open();
        await until(() => row('workbench') !== null);
        await clickOn(row('workbench'));
        await tell({ ...WORKBENCH, state: 'joining', lines: ['Open this page and sign in:', '  https://station.ruimte.app/link?code=BCDF-GHJK', 'BCDF-GHJK'] });
        await until(() => everything().includes('Add the new machine to your account'));

        expect(everything()).toContain('check that it shows the same code');
        expect(document.querySelector<HTMLAnchorElement>('a[href="https://station.ruimte.app/link?code=BCDF-GHJK"]')?.textContent).toBe('Open the page');
        expect(everything()).toContain('Waits for you to sign in');

        await tell({ ...WORKBENCH, state: 'done' });
        await until(() => everything().includes('The machine runs'));

        expect(document.querySelector('a[href^="https://station.ruimte.app/link"]')).toBeNull();
    });

    test('says why a start failed, and offers no start where a machine already runs', async () => {
        candidates = [{ ...WORKBENCH, state: 'failed', failure: 'Start workbench ended with code 3' }];
        await open();
        await until(() => row('workbench') !== null);
        await clickOn(row('workbench'));
        await until(() => everything().includes('Start workbench ended with code 3'));

        expect(buttonWithText('Start')).not.toBeNull();

        await tell({ ...WORKBENCH, running: true });
        await until(() => everything().includes('A machine already runs here'));

        expect(buttonWithText('Start')).toBeNull();
    });

    test('lists nothing from a machine that does not answer the request', async () => {
        machine.answersOnly(['project.open', 'client.list']);
        await open();
        await until(() => everything().includes('Machines'));

        expect(machine.requests('extension.machineList')).toEqual([]);
        expect(everything()).not.toContain('From Harbor');
    });

    test('asks no machine but the one on this computer, so a project on another machine lists none', async () => {
        await open(false);
        await until(() => everything().includes('Machines'));

        expect(machine.requests('extension.machineList')).toEqual([]);
        expect(everything()).not.toContain('From Harbor');
    });
});
