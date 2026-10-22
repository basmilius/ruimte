import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectSummary } from '@ruimte/contracts';
import type { BackgroundServiceState, DesktopBridge } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useProjectList } from '@/state/project-list';
import { protocolRefusal } from '@/transport/protocol';
import { dropMachine, enterWorkspace, showStart } from '@/transport/connections';
import { FakeMachine, connectFakeMachine } from '../../testing/fake-machine';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const scope = globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } };

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

function serviceState(patch: Partial<BackgroundServiceState> = {}): BackgroundServiceState {
    return { support: 'supported', keepRunning: true, owner: 'service', failure: null, linger: null, pendingRestart: { work: 2, answered: true }, ...patch };
}

let machine: FakeMachine;
let disconnect: () => void;
let page: Mounted;
let restarts: number;

/* The shell of the desktop app, with the restart of the service a person put off. */
function installShell(state: BackgroundServiceState | null): void {
    if (state === null) {
        delete scope.window.ruimteDesktop;
        return;
    }
    scope.window.ruimteDesktop = {
        platform: 'darwin',
        pickFolder: async () => null,
        openExternal: async () => undefined,
        openGuestDevTools: () => undefined,
        isFullscreen: async () => false,
        onFullscreen: () => () => undefined,
        claimWindow: async () => false,
        openWindow: () => undefined,
        backgroundService: {
            state: async () => state,
            onState: () => () => undefined,
            setKeepRunning: async () => state,
            enableLinger: async () => state,
            stopMachine: () => undefined,
            restartNow: async () => {
                restarts += 1;
                return serviceState({ pendingRestart: null });
            }
        }
    } as unknown as DesktopBridge;
}

async function openWorkspaceOnThisComputer(): Promise<void> {
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
}

// The connection dot is a status too, so the screen is the status that offers a way out.
function lostScreen(): HTMLElement | null {
    const statuses = [...page.host.querySelectorAll<HTMLElement>('[role="status"]')];
    return statuses.find((status) => [...status.querySelectorAll('button')].some((entry) => entry.textContent?.trim() === 'Open another project')) ?? null;
}

function button(label: string): HTMLButtonElement | null {
    return ([...document.querySelectorAll('button')] as HTMLButtonElement[]).find((entry) => entry.textContent?.trim() === label) ?? null;
}

beforeEach(() => {
    restarts = 0;
});

afterEach(async () => {
    await page.unmount();
    showStart();
    dropMachine(LOCAL_ENDPOINT_ID);
    disconnect();
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useProjectList.getState().forgetProjects(LOCAL_ENDPOINT_ID);
    installShell(null);
});

describe('the screen over a workspace whose machine is this computer and was refused as older', () => {
    test('offers to restart it, and restarts it only once a person confirms', async () => {
        installShell(serviceState());
        await openWorkspaceOnThisComputer();
        await act(async () => machine.lose(protocolRefusal('daemon-older')));
        await until(() => button('Restart machine') !== null);

        await clickOn(button('Restart machine'));
        await until(() => button('Restart now') !== null || button('Restart') !== null);
        expect(restarts).toBe(0);
        await clickOn(button('Restart now') ?? button('Restart'));
        await until(() => restarts === 1);
    });

    test('offers nothing when no restart is pending, and nothing outside the desktop app', async () => {
        installShell(serviceState({ pendingRestart: null }));
        await openWorkspaceOnThisComputer();
        await act(async () => machine.lose(protocolRefusal('daemon-older')));
        await until(() => lostScreen() !== null);
        expect(button('Restart machine')).toBeNull();
        // The sibling actions stay.
        expect(button('Open another project')).not.toBeNull();

        installShell(null);
        await act(async () => machine.reopen());
        await until(() => button('Open another project') === null);
        await act(async () => machine.lose(protocolRefusal('daemon-older')));
        await until(() => button('Open another project') !== null);
        expect(button('Restart machine')).toBeNull();
    });

    test('offers nothing for a machine that is merely silent', async () => {
        installShell(serviceState());
        await openWorkspaceOnThisComputer();
        await act(async () => machine.lose());
        await until(() => lostScreen() !== null);
        expect(button('Restart machine')).toBeNull();
        expect(button('Try again')).not.toBeNull();
    });
});
