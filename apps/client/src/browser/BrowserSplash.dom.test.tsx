import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { PortGrant, ProjectCanvasView, TunnelRow, TunnelState } from '@ruimte/contracts';
import { act } from 'react';
import { usePortGrants } from '@/port-tunnel/grants';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
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

const GRANT: PortGrant = { id: 'grant-1', projectId: 'project-atlas', host: '127.0.0.1', port: 5173, sharedBy: 'person', createdAt: 1 };

/* What the shell offers for a page of another machine at all. */
const ROUTES = { bindBrowserRoute: async () => true, onBrowserRouteBlocked: () => () => undefined };

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
let grants: PortGrant[];

async function open(options: { thisMachine: boolean }): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [VIEW] }, { activeViewId: VIEW.id, views: {} }, {}, options);
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

function tile(): HTMLButtonElement | null {
    return [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('localhost:5173')) ?? null;
}

beforeEach(() => {
    localStorage.clear();
    grants = [];
    machine = new FakeMachine();
    machine.answer('browser.devServers', () => ({ servers: [{ port: 5173, title: 'Vite App' }] }));
    machine.answer('port.list', () => ({ grants }));
    machine.answer('tunnel.state', () => tunnelState([]));
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    removeDesktop();
    usePortGrants.setState({ byEndpoint: {} });
});

describe('sharing a dev port from the start page of a browser node', () => {
    test('asks before it shares, says what a shared dev site can do, and then names the port and the project', async () => {
        installDesktop();
        await open({ thisMachine: true });
        await clickOn(buttonWith('Share'));
        await until(() => (document.body.textContent ?? '').includes('Share port 5173?'));

        expect(document.body.textContent).toContain('A development site may accept writes and uploads');
        expect(machine.requests('port.share')).toEqual([]);

        machine.answer('port.share', () => {
            grants = [GRANT];

            return { grant: GRANT };
        });
        await clickOn(buttonWith('Share port'));
        await until(() => machine.requests('port.share').length === 1);

        expect(machine.requests('port.share')).toEqual([{ projectId: 'project-atlas', port: 5173 }]);
    });

    test('offers to stop a port that is shared, and stopping tells the machine which grant', async () => {
        installDesktop();
        grants = [GRANT];
        await open({ thisMachine: true });
        await until(() => buttonWith('Stop sharing') !== null);
        machine.answer('port.revoke', () => ({}));
        await clickOn(buttonWith('Stop sharing'));
        await until(() => machine.requests('port.revoke').length === 1);

        expect(machine.requests('port.revoke')).toEqual([{ id: 'grant-1' }]);
    });

    test('hears a port shared elsewhere and shows it', async () => {
        installDesktop();
        await open({ thisMachine: true });

        grants = [GRANT];
        await act(async () => machine.emit('port.changed', {}));
        await until(() => buttonWith('Stop sharing') !== null);
    });

    test('offers the way onto a tunnel hostname, and the public address once the port has a running one', async () => {
        installDesktop();
        await open({ thisMachine: true });

        expect(buttonWith('Put this port on a tunnel')).not.toBeNull();

        machine.answer('tunnel.state', () =>
            tunnelState([{ id: 'row-1', kind: 'dev', hostname: 'docs.example.com', port: 5173, enabled: true, comeBack: false }])
        );
        await act(async () => machine.emit('tunnel.changed', {}));
        await until(() => buttonWith('Copy https://docs.example.com') !== null);
    });
});

describe('a dev port of another machine in the desktop app', () => {
    test('stays shut while the machine shares nothing, and says why', async () => {
        installDesktop({ ...ROUTES, openPortTunnel: async () => null, onPortTunnel: () => () => undefined, portTunnelSend: () => undefined });
        await open({ thisMachine: false });

        expect(tile()?.disabled).toBe(true);
        expect(tile()?.textContent).toContain('Not shared by Fake machine');
        expect(buttonWith('Share')).toBeNull();
    });

    test('opens once the machine shares it', async () => {
        installDesktop({ ...ROUTES, openPortTunnel: async () => null, onPortTunnel: () => () => undefined, portTunnelSend: () => undefined });
        grants = [GRANT];
        await open({ thisMachine: false });
        await until(() => tile()?.disabled === false);

        expect(document.body.textContent).toContain('Shared by Fake machine');
    });

    test('says an app from before shared ports cannot open one', async () => {
        installDesktop(ROUTES);
        await open({ thisMachine: false });

        expect(tile()?.disabled).toBe(true);
        expect(tile()?.textContent).toContain('This version of Ruimte cannot open a shared port');
    });
});
