import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectSummary } from '@ruimte/contracts';
import { act } from 'react';
import type { BackgroundServiceState } from '@/desktop/bridge';
import { useMachineUpdateAgain } from '@/shell/machine-update';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useProjectList } from '@/state/project-list';
import { dropMachine, enterWorkspace, showStart } from '@/transport/connections';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { buttonWithText, installDesktop, removeDesktop } from '../../testing/dom-helpers';
import { FakeMachine, connectFakeMachine } from '../../testing/fake-machine';
import { machineBridge } from '../../testing/machine-bridge';

const PROJECT: ProjectSummary = {
    projectId: 'project-atlas',
    name: 'Atlas',
    color: '#000',
    folder: '/work/atlas',
    lastOpenedAt: 0,
    closedAt: null,
    available: true,
    icon: { kind: 'initial', value: 'A' },
    nameSource: 'chosen'
};

const MARK = 'Ruimte was updated. This machine still runs the old version and restarts once idle.';

function serviceState(pendingRestart: BackgroundServiceState['pendingRestart']): BackgroundServiceState {
    return { support: 'supported', keepRunning: true, owner: 'service', failure: null, linger: null, pendingRestart };
}

let machine: FakeMachine;
let disconnect: () => void;
let page: Mounted;
let restarts: number;
let current: BackgroundServiceState;
let listeners: Set<(state: BackgroundServiceState) => void>;

/* What the shell sends every window, as it does after each answer. */
function publish(state: BackgroundServiceState): BackgroundServiceState {
    current = state;
    listeners.forEach((listener) => listener(state));
    return state;
}

/* The desktop shell holding a restart; `running` is what its machine says runs on it now. */
function installShell(pendingRestart: BackgroundServiceState['pendingRestart'], running = { terminals: 1, agents: 3 }): void {
    restarts = 0;
    current = serviceState(pendingRestart);
    listeners = new Set();
    installDesktop({
        claimWindow: async () => false,
        openWindow: () => undefined,
        machine: machineBridge('local', { stopPreview: async () => ({ work: running, home: '~/.ruimte', commandLine: false }) }),
        backgroundService: {
            state: async () => current,
            onState: (listener) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            setKeepRunning: async () => current,
            enableLinger: async () => current,
            stopMachine: () => undefined,
            restartNow: async () => {
                restarts += 1;
                return publish(serviceState(null));
            },
            restartWhenIdle: async () => publish(serviceState(current.pendingRestart && { ...current.pendingRestart, answered: true }))
        }
    });
}

async function openWorkspace(): Promise<void> {
    machine = new FakeMachine();
    machine.answer('project.open', () => ({
        summary: PROJECT,
        document: { version: 3, rev: 1, name: 'Atlas', color: '#000', views: [], shared: [] } as never,
        local: { activeViewId: null, views: {} } as never
    }));
    machine.answer('project.list', () => ({ projects: [PROJECT] }) as never);
    disconnect = connectFakeMachine(machine, LOCAL_ENDPOINT_ID);
    await enterWorkspace(LOCAL_ENDPOINT_ID, { projectId: PROJECT.projectId });
    page = mount();
    await page.renderApp();
    await until(() => document.querySelector('[aria-label="Search"]') !== null);
}

function mark(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(`button[aria-label="${MARK}"]`);
}

afterEach(async () => {
    await page.unmount();
    showStart();
    dropMachine(LOCAL_ENDPOINT_ID);
    disconnect();
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useProjectList.getState().forgetProjects(LOCAL_ENDPOINT_ID);
    useMachineUpdateAgain.setState({ again: null });
    removeDesktop();
});

describe('the rail while the machine still runs the old version', () => {
    test('keeps a mark after "When idle" that asks again with what runs now', async () => {
        installShell({ work: 1, answered: true });
        await openWorkspace();
        await until(() => mark() !== null);
        expect(buttonWithText('Restart now')).toBeNull();

        await clickOn(mark());
        await until(() => buttonWithText('Restart now') !== null);
        expect(document.body.textContent).toContain('This ends 4 running terminals and agents.');

        await clickOn(buttonWithText('Restart now'));
        await until(() => restarts === 1 && mark() === null && buttonWithText('Restart now') === null);
    });

    test('shows no mark while the question is still open, nor once the machine restarted', async () => {
        installShell({ work: 1, answered: false });
        await openWorkspace();
        await until(() => buttonWithText('When idle') !== null);
        expect(mark()).toBeNull();

        await clickOn(buttonWithText('When idle'));
        await until(() => mark() !== null && buttonWithText('When idle') === null);

        // The idle pass of the shell restarted the machine onto the new build.
        await act(async () => void publish(serviceState(null)));
        await until(() => mark() === null);
    });
});
