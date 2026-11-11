import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, TunnelRow, TunnelState } from '@ruimte/contracts';
import { act } from 'react';
import { mount, until, type Mounted } from '../../testing/dom';
import { installDesktop, removeDesktop } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const VIEW: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [{ id: 'page', kind: 'browser', title: 'Docs', x: 0, y: 0, w: 640, h: 420 }],
    texts: [],
    edges: [],
    layouts: []
};

function tunnelState(rows: TunnelRow[]): TunnelState {
    return {
        stage: 'running',
        message: null,
        hasToken: true,
        accounts: [],
        account: null,
        zones: [],
        tunnel: { name: 'ruimte-studio-4f2a', created: true, runner: 'ruimte', others: [] },
        rows,
        mcp: { enabled: false, port: null },
        clients: 0,
        suggestedMcpLabel: null
    };
}

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

async function open(): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [VIEW] }, { activeViewId: VIEW.id, views: {} }, {}, { thisMachine: true });
    page = mount();
    await page.renderApp();
    await until(() => (document.body.textContent ?? '').includes('localhost:5173'));
}

function buttonWith(text: string): HTMLButtonElement | null {
    return (
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(
            (button) => button.textContent?.trim() === text || button.getAttribute('aria-label') === text
        ) ?? null
    );
}

beforeEach(() => {
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('browser.devServers', () => ({ servers: [{ port: 5173, title: 'Vite App' }] }));
    machine.answer('tunnel.state', () => tunnelState([]));
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    removeDesktop();
});

describe('a running dev port on the start page of a browser node', () => {
    test('offers the way onto a tunnel hostname, and the public address once the port has a running one', async () => {
        installDesktop();
        await open();

        expect(buttonWith('Put this port on a tunnel')).not.toBeNull();

        machine.answer('tunnel.state', () =>
            tunnelState([{ id: 'row-1', kind: 'dev', hostname: 'docs.example.com', port: 5173, enabled: true, comeBack: false }])
        );
        await act(async () => machine.emit('tunnel.changed', {}));
        await until(() => buttonWith('Copy https://docs.example.com') !== null);
    });
});
