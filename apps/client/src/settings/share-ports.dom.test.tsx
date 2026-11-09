import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { EndpointInfo, ProjectCanvasView } from '@ruimte/contracts';
import { act } from 'react';
import { useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { startServerInfo } from '@/workspace/server-info';
import { startEndpointWatch } from '@/workspace/watch';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { clickOn, until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';

const MACHINE = 'fake-machine';
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };
const LABEL = 'Agents on Fake machine may share a dev port';

let machine: FakeMachine;
let canvas: CanvasPage;
let sharing: boolean;
let stops: Array<() => void>;

function info(): EndpointInfo {
    return { id: MACHINE, label: 'Fake machine', platform: 'darwin', version: '1', reachability: 'lan', authenticated: true, agentsSharePorts: sharing };
}

function sharingSwitch(): HTMLElement | null {
    return document.querySelector(`[role="switch"][aria-label="${LABEL}"]`);
}

beforeEach(async () => {
    machine = new FakeMachine();
    sharing = false;
    machine.answer('endpoint.info', () => info());
    machine.answer('endpoint.setIdentity', (payload) => {
        sharing = payload.agentsSharePorts ?? sharing;

        return info();
    });
    stops = [startServerInfo(), startEndpointWatch()];
    canvas = await openCanvasPage(machine, [MAIN], () => useServers.getState().byEndpoint[MACHINE] !== undefined);
    await act(async () => useUi.getState().setSettings({ open: true, section: 'agents' }));
    await until(() => sharingSwitch() !== null);
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await canvas.close();
    stops.forEach((stop) => stop());
    useServers.getState().forget(MACHINE);
});

describe('Settings > Agents > sharing a dev port', () => {
    test('is off until a person turns it on, and the machine is told each time', async () => {
        expect(document.body.textContent).toContain('An agent can share the port of a dev server with your other devices');
        expect(sharingSwitch()!.getAttribute('aria-checked')).toBe('false');

        await clickOn(sharingSwitch());
        await until(() => sharingSwitch()!.getAttribute('aria-checked') === 'true');
        await clickOn(sharingSwitch());
        await until(() => sharingSwitch()!.getAttribute('aria-checked') === 'false');

        expect(machine.requests('endpoint.setIdentity').map((payload) => payload.agentsSharePorts)).toEqual([true, false]);
    });
});
