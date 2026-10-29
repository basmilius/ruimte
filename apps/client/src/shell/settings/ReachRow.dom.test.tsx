import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { act } from 'react';
import { REQUEST_SCHEMAS, type EndpointInfo, type ReachCheck, type RequestType } from '@ruimte/contracts';
import { endpointById, LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { ReachRow } from '@/shell/settings/MachineSettings';
import { useUi } from '@/state/ui';
import { useWindow } from '@/state/window';
import { adoptEndpointInfo } from '@/transport/server-info';
import { clickOn, mount, until, type Mounted } from '../../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../../testing/fake-machine';
import { everything, installDesktop, removeDesktop } from '../../../testing/dom-helpers';

const NOW = Date.UTC(2026, 9, 1);
const MINUTE_MS = 60_000;

const INFO: EndpointInfo = { id: 'machine-1', label: 'Studio', platform: 'darwin', version: '1.0.0', reachability: 'loopback', authenticated: false };

function reach(cause: string, severity: ReachCheck['severity']): ReachCheck {
    return {
        checkedAt: NOW,
        cause,
        severity,
        facts: {
            broker: { url: 'wss://broker.ruimte.app', connected: true },
            granted: true,
            probes: [],
            lanDoor: { wanted: true, listening: true, port: 4220, addresses: 1 },
            tunnel: 'utun4'
        }
    };
}

let page: Mounted;
let release: () => void;
let machine: FakeMachine;

function checkAgain(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>('[aria-label="Check again whether other devices reach This machine"]');
}

async function open(setUp: (machine: FakeMachine) => void): Promise<void> {
    machine = new FakeMachine();
    setUp(machine);
    release = connectFakeMachine(machine);
    installDesktop();
    page = mount();
    await page.renderApp();
    await act(async () => adoptEndpointInfo(LOCAL_ENDPOINT_ID, INFO));
    await act(async () => useUi.getState().setSettings({ open: true, section: 'machines', target: 'machines.machine.reach' }));
}

beforeEach(() => {
    useWindow.getState().setBooting(false);
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false, target: null }));
    await page.unmount();
    release();
    removeDesktop();
    jest.useRealTimers();
});

/* `until` waits on a timer, which a fake clock never runs on its own; this waits on turns of the event loop instead. */
async function untilUnderFakeClock(condition: () => boolean): Promise<void> {
    for (let turn = 0; turn < 200 && !condition(); turn++) {
        await act(async () => {
            await new Promise((resolve) => setImmediate(resolve));
        });
    }
    expect(condition()).toBe(true);
}

describe('Settings > Machines > this machine > Reachable from other devices', () => {
    test('says what the machine found and what to do, and checks again on request', async () => {
        await open((fake) =>
            fake.answer('endpoint.reach', (payload) => ({ reach: payload.check === true ? reach('ok', 'ok') : reach('vpn-blocks-udp', 'relayed') }))
        );
        await until(() => everything().includes('utun4 blocks the direct route'));
        expect(everything()).toContain('Let Ruimte bypass the VPN');
        expect(machine.requests('endpoint.reach')).toEqual([{}]);

        await clickOn(checkAgain());
        await until(() => everything().includes('Your other devices can reach this machine.'));
        expect(machine.requests('endpoint.reach')).toEqual([{}, { check: true }]);
    });

    test('says how long ago the machine checked, and counts on while the row stays open', async () => {
        machine = new FakeMachine();
        machine.answer('endpoint.reach', () => ({ reach: reach('ok', 'ok') }));
        release = connectFakeMachine(machine);
        // Only the row runs on the fake clock: a timer the whole window set on it would be lost for the files after this one.
        jest.useFakeTimers({ now: NOW + 2 * MINUTE_MS });
        page = mount();
        await page.render(<ReachRow endpoint={endpointById(LOCAL_ENDPOINT_ID)!} reason={null} />);
        await untilUnderFakeClock(() => everything().includes('Checked 2m ago.'));

        await act(async () => jest.advanceTimersByTime(3 * MINUTE_MS));
        expect(everything()).toContain('Checked 5m ago.');
        expect(machine.requests('endpoint.reach')).toEqual([{}]);
    });

    test('a check that fails says why', async () => {
        await open((fake) =>
            fake.answer('endpoint.reach', () => {
                throw new Error('the machine went away');
            })
        );
        await until(() => everything().includes('The check did not finish: the machine went away'));
    });

    test('is not offered by a machine from before the check', async () => {
        await open((fake) => fake.answersOnly((Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => type !== 'endpoint.reach')));
        await until(() => everything().includes('Local network'));
        expect(checkAgain()).toBeNull();
        expect(machine.requests('endpoint.reach')).toEqual([]);
    });
});
