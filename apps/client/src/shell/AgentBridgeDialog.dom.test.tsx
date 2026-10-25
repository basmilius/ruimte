import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { REQUEST_SCHEMAS, type ProjectCanvasView, type RequestType } from '@ruimte/contracts';
import { swapPeerLinker } from '@/project/peer-linker';
import { useEndpoints } from '@/state/endpoints';
import { useUi } from '@/state/ui';
import { AgentBridgeDialog } from './AgentBridgeDialog';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const MAC = 'mac';
const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    edges: [],
    texts: [],
    layouts: [],
    nodes: [{ id: 'lead', kind: 'chat', title: 'Windows lead', x: 0, y: 0, w: 500, h: 500 }]
};
let here: FakeMachine;
let there: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let disconnect: () => void;
let restore: () => void;
let admission: string[];

beforeEach(async () => {
    admission = [];
    restore = swapPeerLinker(async (machineId) => {
        admission.push(machineId);
    });
    here = new FakeMachine();
    there = new FakeMachine();
    here.answer('remote.list', () => ({ links: [{ machineId: MAC, remoteProjectId: 'mac-project', label: 'Ricks-MacBook-Pro.local', rootCommit: '' }] }));
    there.answer('bridge.candidates', () => ({ agents: [{ nodeId: 'builder', title: 'Mac builder', canvas: 'Mac work' }] }));
    useEndpoints.getState().add({
        id: MAC,
        label: 'Ricks-MacBook-Pro.local',
        httpBaseUrl: 'http://127.0.0.1:2',
        wsBaseUrl: 'ws://127.0.0.1:2',
        reachability: 'lan',
        daemonId: null,
        daemonPublicKey: null
    });
    disconnect = connectFakeMachine(there, MAC);
    workspace = await openFakeWorkspace(here, { views: [MAIN] }, { activeViewId: 'main', views: {} });
    page = mount();
    await page.render(<AgentBridgeDialog />);
});

afterEach(async () => {
    await act(async () => useUi.getState().setAgentBridgeDialog(null));
    await page.unmount();
    workspace.close();
    disconnect();
    restore();
    useEndpoints.getState().remove(MAC);
});

async function open(): Promise<void> {
    await act(async () => useUi.getState().setAgentBridgeDialog({ nodeId: 'lead', endpointId: 'fake-machine', title: 'Windows lead' }));
    await until(() => document.querySelector('[role="dialog"]') !== null);
}
function button(label: string): HTMLButtonElement | null {
    return [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((item) => item.textContent === label) ?? null;
}

describe('connecting an existing Mac agent', () => {
    test('shows the existing agent and its canvas, then grants only that pair on both machines', async () => {
        await open();
        await until(() => document.body.textContent?.includes('Mac builder') === true);
        expect(document.body.textContent).toContain('Ricks-MacBook-Pro.local');
        expect(document.body.textContent).toContain('Mac work');
        await clickOn(button('Connect'));
        await until(() => here.requests('bridge.bind').length === 1);
        const local = here.requests('bridge.bind')[0]!;
        expect(local).toMatchObject({ nodeId: 'lead', machineId: MAC, remoteNodeId: 'builder' });
        expect(there.requests('bridge.bind')[0]).toMatchObject({ id: local.id, projectId: 'mac-project', nodeId: 'builder', remoteNodeId: 'lead' });
        expect(admission).toEqual([MAC, 'fake-machine']);
        expect(here.requests('chat.send')).toEqual([]);
        expect(there.requests('chat.send')).toEqual([]);
    });

    test('removes the remote grant when saving the local grant fails', async () => {
        here.answer('bridge.bind', () => {
            throw new Error('Saving the connection failed');
        });
        await open();
        await until(() => document.body.textContent?.includes('Mac builder') === true);
        await clickOn(button('Connect'));
        await until(() => document.body.textContent?.includes('Saving the connection failed') === true);
        expect(there.requests('bridge.remove')).toEqual([{ id: there.requests('bridge.bind')[0]!.id }]);
    });

    test('asks for an update before calling a new request on an older Mac', async () => {
        there.answersOnly((Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => !type.startsWith('bridge.')));
        await open();
        await until(() => document.body.textContent?.includes('Update Ruimte on both machines') === true);
        expect(there.requests('bridge.candidates')).toEqual([]);
        expect(button('Connect')?.disabled).toBe(true);
    });

    test('explains how to link a machine when this project has none', async () => {
        here.answer('remote.list', () => ({ links: [] }));
        await open();
        await until(() => document.body.textContent?.includes('Link the other machine to this project first') === true);
        expect(button('Connect')?.disabled).toBe(true);
    });
});
