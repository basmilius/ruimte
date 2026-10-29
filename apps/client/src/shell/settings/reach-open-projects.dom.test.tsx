import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { EndpointInfo, ProjectCanvasView } from '@ruimte/contracts';
import { startEndpointWatch } from '@/endpoint/watch';
import { useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { startServerInfo } from '@/transport/server-info';
import { FakeMachine } from '../../../testing/fake-machine';
import { clickOn, until } from '../../../testing/dom';
import { openCanvasPage, type CanvasPage } from '../../../testing/canvas-page';

const MACHINE = 'fake-machine';
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };
const LABEL = 'Agents on Fake machine may reach all open projects';

let machine: FakeMachine;
let canvas: CanvasPage;
let reach: boolean;
let stops: Array<() => void>;

function info(): EndpointInfo {
    return { id: MACHINE, label: 'Fake machine', platform: 'darwin', version: '1', reachability: 'lan', authenticated: true, reachOpenProjects: reach };
}

function reachSwitch(): HTMLElement | null {
    return document.querySelector(`[role="switch"][aria-label="${LABEL}"]`);
}

beforeEach(async () => {
    machine = new FakeMachine();
    reach = false;
    machine.answer('endpoint.info', () => info());
    machine.answer('endpoint.setIdentity', (payload) => {
        reach = payload.reachOpenProjects ?? reach;
        return info();
    });
    stops = [startServerInfo(), startEndpointWatch()];
    canvas = await openCanvasPage(machine, [MAIN], () => useServers.getState().byEndpoint[MACHINE] !== undefined);
    await act(async () => useUi.getState().setSettings({ open: true, section: 'agents' }));
    await until(() => reachSwitch() !== null);
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await canvas.close();
    stops.forEach((stop) => stop());
    useServers.getState().forget(MACHINE);
});

describe('Settings > Agents > reaching all open projects', () => {
    test('a person turns the switch on and off, and the machine is told each time', async () => {
        expect(document.body.textContent).toContain('Agents in one project can read your other open projects and start agents there.');
        expect(reachSwitch()!.getAttribute('aria-checked')).toBe('false');

        await clickOn(reachSwitch());
        await until(() => reachSwitch()!.getAttribute('aria-checked') === 'true');
        await clickOn(reachSwitch());
        await until(() => reachSwitch()!.getAttribute('aria-checked') === 'false');

        expect(machine.requests('endpoint.setIdentity').map((payload) => payload.reachOpenProjects)).toEqual([true, false]);
    });
});
