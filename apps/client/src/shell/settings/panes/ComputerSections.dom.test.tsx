import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ComputerAppGrants } from '@ruimte/contracts';
import { startComputerWatch } from '@/computer/watch';
import type { DesktopBridge } from '@/desktop/bridge';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { useUi } from '@/state/ui';
import { useWindow } from '@/state/window';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../../../testing/fake-machine';
import { machineBridge } from '../../../../testing/machine-bridge';
import { buttonWithText, everything, installDesktop, removeDesktop } from '../../../../testing/dom-helpers';

const previousTimeZone = process.env.TZ;
process.env.TZ = 'UTC';

afterAll(() => {
    if (previousTimeZone === undefined) {
        delete process.env.TZ;
    } else {
        process.env.TZ = previousTimeZone;
    }
});

// A machine of the list, so the pane has a row of its own to wait for beside the one under test.
const ATTIC: Endpoint = {
    id: 'attic',
    label: 'Attic',
    httpBaseUrl: 'http://127.0.0.1:1',
    wsBaseUrl: 'ws://127.0.0.1:1',
    reachability: 'lan',
    daemonId: null,
    daemonPublicKey: null
};

let page: Mounted;
let chosen: string[];
let release: (() => void) | null;

async function open(platform: string, machine: DesktopBridge['machine']): Promise<void> {
    installDesktop({ platform, machine });
    useEndpoints.getState().add(ATTIC);
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'agents' }));
    await until(() => everything().includes('Allow computer use on Attic'));
}

async function openGrants(grants: ComputerAppGrants): Promise<FakeMachine> {
    const machine = new FakeMachine();
    machine.answer('computer.status', () => ({ enabled: true, present: true, running: true, accessibility: true, screenRecording: true }));
    machine.answer('computer.grants', () => grants);
    const releaseMachine = connectFakeMachine(machine);
    const stopWatch = startComputerWatch();
    release = () => {
        stopWatch();
        releaseMachine();
    };
    await open('darwin', machineBridge('local'));
    await until(() => everything().includes('Allowed apps'));
    return machine;
}

beforeEach(() => {
    chosen = [];
    release = null;
    useWindow.getState().setBooting(false);
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    release?.();
    useEndpoints.getState().remove(ATTIC.id);
    removeDesktop();
});

describe('Settings > Agents > Computer use of an app that runs no machine', () => {
    test('a Mac shows the row off, and the button opens the restart question', async () => {
        await open(
            'darwin',
            machineBridge('none', {
                choose: async (mode) => {
                    chosen.push(mode);
                }
            })
        );
        expect(everything()).toContain('Allow computer use on this Mac');
        expect(everything()).toContain('Run a machine here first.');
        const switchControl = document.querySelector<HTMLElement>('[role="switch"][aria-label="Allow computer use on this Mac"]');
        expect(switchControl).not.toBeNull();
        expect(switchControl?.getAttribute('aria-checked')).toBe('false');
        expect(switchControl?.hasAttribute('disabled') || switchControl?.getAttribute('aria-disabled') === 'true').toBe(true);
        await clickOn(buttonWithText('Set up a machine…'));
        await until(() => everything().includes('Restart Ruimte to run a machine here?'));
        await clickOn(buttonWithText('Restart'));
        expect(chosen).toEqual(['local']);
    });

    test('another system has no row', async () => {
        await open('linux', machineBridge('none'));
        expect(everything()).not.toContain('Allow computer use on this Mac');
    });

    test('an app that runs a machine has no row', async () => {
        // An app with a machine connects to it, so a fake stands behind the pool instead of a socket.
        release = connectFakeMachine(new FakeMachine());
        await open('darwin', machineBridge('local'));
        expect(everything()).not.toContain('Allow computer use on this Mac');
    });
});

describe('Settings > Agents > Computer use app grants', () => {
    test('empty app grants show their empty states without revoke controls', async () => {
        const machine = await openGrants({ always: [], terminals: [], thisTime: [] });
        expect(everything()).toContain('No apps allowed.');
        expect(everything()).toContain('No terminal apps seen yet.');
        expect(everything()).not.toContain('This time');
        for (const label of ['Allowed apps', 'Terminal apps']) {
            const section = document.querySelector(`section[aria-label="${label}"]`);
            expect(section).not.toBeNull();
            expect(section!.querySelectorAll('button')).toHaveLength(0);
        }
        expect(machine.requests('computer.revoke')).toEqual([]);
    });

    test('each app grant revokes its own kind, app and temporary chat', async () => {
        const machine = await openGrants({
            always: [{ name: 'TextEdit', bundleId: 'com.example.textedit', at: Date.UTC(2026, 8, 19, 12) }],
            terminals: [{ name: 'Shells', bundleId: 'com.example.shells', at: Date.UTC(2026, 8, 20, 12) }],
            thisTime: [{ name: 'Notes', bundleId: 'com.example.notes', at: 1, nodeId: 'chat-1', nodeTitle: 'Fix the login', projectName: 'Ruimte' }]
        });
        expect(everything()).toContain('TextEdit');
        expect(everything()).toContain('Allowed Sep 19, 2026');
        expect(everything()).toContain('Shells');
        expect(everything()).toContain('Notes');
        expect(everything()).toContain('This time');
        expect(everything()).toContain('Fix the login · Ruimte');
        expect(everything()).not.toContain('No apps');
        const labels = ['Remove TextEdit', 'Shells is not a terminal', 'Remove Notes'];
        const controls = labels.map((label) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`));
        expect(controls.every((control) => control !== null && !control.disabled)).toBe(true);
        await clickOn(controls[0]!);
        await clickOn(controls[1]!);
        await clickOn(controls[2]!);
        expect(machine.requests('computer.revoke')).toEqual([
            { bundleId: 'com.example.textedit', kind: 'always' },
            { bundleId: 'com.example.shells', kind: 'terminal' },
            { bundleId: 'com.example.notes', kind: 'thisTime', nodeId: 'chat-1' }
        ]);
    });
});
