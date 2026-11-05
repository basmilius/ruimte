import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { usePeerLapse } from '@/clients/project/peer-lapse';
import { swapPeerLinker } from '@/clients/project/peer-linker';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

// The row of the machine is keyed on one id and the machine calls itself another, as this computer's own row does.
const ROW = 'row-of-the-mac';
const DAEMON = 'daemon-of-the-mac';
const SHELL: ProjectNode = { id: 'shell', kind: 'terminal', title: 'Shell here', x: 0, y: 0, w: 560, h: 360 };
const THERE: ProjectNode = { id: 'there', kind: 'terminal', title: 'Shell there', x: 700, y: 0, w: 560, h: 360, machine: DAEMON };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [SHELL, THERE], texts: [], edges: [], layouts: [] };

let here: FakeMachine;
let there: FakeMachine;
let workspace: FakeWorkspace;
let disconnectThere: () => void;
let page: Mounted;
let restoreLinker: () => void;
let linked: string[];

function pill(): HTMLElement | null {
    // A lapsed link is the pill in the error tone, which is also the one that can be clicked.
    return page.host.querySelector(`[data-node-id="${THERE.id}"] header button[class*="text-status-error"]`);
}

beforeEach(async () => {
    linked = [];
    restoreLinker = swapPeerLinker(async (machineId) => void linked.push(machineId));
    here = new FakeMachine();
    there = new FakeMachine();
    useEndpoints.getState().add({
        id: ROW,
        label: 'Mac Studio',
        httpBaseUrl: 'http://127.0.0.1:2',
        wsBaseUrl: 'ws://127.0.0.1:2',
        reachability: 'lan',
        daemonId: DAEMON,
        daemonPublicKey: null
    });
    disconnectThere = connectFakeMachine(there, ROW);
    workspace = await openFakeWorkspace(here, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-node-id="${THERE.id}"]`) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    disconnectThere();
    restoreLinker();
    usePeerLapse.setState({ lapsed: {} });
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useEndpoints.getState().remove(ROW);
});

describe('the pill of a node on another machine', () => {
    test('offers the way back when the link of that machine lapsed, which is kept under the id the machine mints', async () => {
        expect(pill()).toBeNull();
        await act(async () => usePeerLapse.setState({ lapsed: { [DAEMON]: true } }));
        await until(() => pill() !== null);
    });

    test('is not marked by a lapse under the key of its row, and links the machine by its own id', async () => {
        await act(async () => usePeerLapse.setState({ lapsed: { [ROW]: true } }));
        expect(pill()).toBeNull();

        await act(async () => usePeerLapse.setState({ lapsed: { [DAEMON]: true } }));
        await until(() => pill() !== null);
        await clickOn(pill());
        await until(() => linked.length > 0);
        expect(linked).toEqual([DAEMON]);
        await until(() => usePeerLapse.getState().lapsed[DAEMON] === undefined);
    });
});
