import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { MachineCandidate } from '@ruimte/contracts';
import type { DevcontainerBridge, DevcontainerStart } from '@ruimte/desktop-bridge';
import type { Machine } from '@ruimte/pulsar';
import { act } from 'react';
import { forgetCachedList } from '@/clients/project/list';
import type { DesktopBridge } from '@/desktop/bridge';
import { useDevcontainers } from '@/machine-ui/devcontainers';
import { startPulsarAccount, usePulsarAccount } from '@/pulsar/account';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useProjectList } from '@/state/project-list';
import { endpointForAccountMachine, usePulsarMachines } from '@/state/pulsar-machines';
import { useUi } from '@/state/ui';
import { forgetAccountMachines } from '@/workspace/account-machines';
import { dropMachine, showStart } from '@/workspace/connections';
import { useWindow } from '@/workspace/window';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { buttonWithText, everything, removeDesktop } from '../../testing/dom-helpers';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { machineBridge } from '../../testing/machine-bridge';
import { projectSummary } from '../../testing/project-fixtures';

const ID = 'ruimte-devcontainer-shop-1a2b3c4d';
const ACCOUNT = { id: 'account-1', provider: 'github' as const, login: 'someone', displayName: null };
const ACCESS_TOKEN = 'a'.repeat(43);
const FAR = Date.UTC(2100, 0, 1);
const REGISTRATION = {
    id: 'machine-shop',
    name: 'Shop',
    icon: null,
    brokerUrl: 'wss://broker.ruimte.app',
    publicKey: Buffer.from(Uint8Array.from({ length: 32 }, (_value, i) => i)).toString('base64url'),
    issuedAt: 1_000_000,
    signature: 's'.repeat(86)
};
const SHOP: Machine = { id: 'machine-shop', name: 'Shop', icon: null, publicKey: REGISTRATION.publicKey, brokerUrl: REGISTRATION.brokerUrl, lastSeenAt: null };
const CANDIDATE: MachineCandidate = {
    source: { extension: 'ruimte', id: 'devcontainer', title: 'Dev Containers' },
    id: ID,
    title: 'Shop',
    place: ID,
    running: false,
    state: 'held',
    lines: [],
    held: {
        digest: 'digest-1',
        programs: [
            { title: 'Pull debian:bookworm-slim, unless it is here already', command: 'sh -c ... debian:bookworm-slim', cwd: '/work/shop' },
            { join: true, command: `docker exec ${ID} ruimte join account-1`, cwd: '/work/shop' }
        ]
    }
};
const HELD: DevcontainerStart = { id: ID, folder: '/work/shop', candidate: CANDIDATE, workspaceFolder: '/workspaces/shop', machineId: null };
const realFetch = globalThis.fetch;

interface Shell {
    picks: string[];
    starts: Array<[string, string, string]>;
    stops: string[];
    joined: string[];
    /* What the next pick and start answer. */
    picked: DevcontainerStart | null;
    started: DevcontainerStart;
    listener: ((start: DevcontainerStart) => void) | null;
}

let shell: Shell;
let posted: unknown[];
let page: Mounted;
let there: FakeMachine;
let disconnect: (() => void) | null;

/* The shell of an app in machine mode `none`, with the folder picker and Docker behind a fake. */
function installShell(): void {
    shell = { picks: [], starts: [], stops: [], joined: [], picked: HELD, started: HELD, listener: null };

    const devcontainers: DevcontainerBridge = {
        pick: async (accountId) => {
            shell.picks.push(accountId);

            return shell.picked;
        },
        list: async () => (shell.picks.length > 0 && shell.picked !== null ? [shell.picked] : []),
        start: async (id, accountId, digest) => {
            shell.starts.push([id, accountId, digest]);

            return shell.started;
        },
        stop: async (id) => void shell.stops.push(id),
        registration: async () => REGISTRATION,
        joined: async (id) => void shell.joined.push(id),
        onChanged: (listener) => {
            shell.listener = listener;

            return () => {
                shell.listener = null;
            };
        }
    };
    const bridge: DesktopBridge = {
        platform: 'darwin',
        pickFolder: async () => null,
        openExternal: async () => undefined,
        openGuestDevTools: () => undefined,
        machine: machineBridge('none'),
        devcontainers
    };

    (globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } }).window.ruimteDesktop = bridge;
}

function tell(start: DevcontainerStart): Promise<void> {
    return act(async () => shell.listener?.(start));
}

/* Signed in to an address book that lists the new machine once this window posted it. */
async function signIn(): Promise<void> {
    globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
        const path = new URL(input).pathname;

        if (path === '/v1/providers') {
            return Response.json({ providers: ['github'] });
        }

        if (path !== '/v1/machines') {
            return Response.json({ error: { code: 'not-found', message: 'Not found' } }, { status: 404 });
        }

        if (init.method === 'POST') {
            posted.push(JSON.parse(String(init.body)));

            return Response.json({ machine: SHOP });
        }

        return Response.json({ machines: posted.length > 0 ? [SHOP] : [] });
    }) as typeof fetch;

    await startPulsarAccount({
        addressBook: async () => 'https://pulsar.test',
        keeper: {
            exchange: async () => {
                throw new Error('not used');
            },
            refresh: async () => ({ accessToken: ACCESS_TOKEN, accessExpiresAt: FAR, expiresAt: FAR, account: ACCOUNT }),
            restore: async () => ({ account: ACCOUNT, expiresAt: FAR }),
            signOut: async () => undefined
        }
    });
    // What the window read of the account when it signed in, before the new machine was on it.
    usePulsarMachines.setState({ machines: [] });
}

function tile(): HTMLButtonElement | null {
    return (
        [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.includes('Open a folder in a dev container')) ?? null
    );
}

beforeEach(async () => {
    installShell();
    posted = [];
    disconnect = null;
    useWindow.getState().setBooting(false);
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    // The folder opened on the new machine is in the window, which the next file finds as it was.
    showStart();
    dropMachine(SHOP.id);
    disconnect?.();
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useEndpoints.getState().remove(SHOP.id);
    useProjectList.getState().setProjects(SHOP.id, []);
    forgetCachedList(SHOP.id);
    removeDesktop();
    globalThis.fetch = realFetch;
    await startPulsarAccount(null);
    usePulsarAccount.setState(usePulsarAccount.getInitialState());
    forgetAccountMachines();
    useDevcontainers.setState(useDevcontainers.getInitialState(), true);
});

describe('a folder in a dev container, in an app that runs no machine', () => {
    test('picks the folder, starts only after the yes, shows how it goes, and opens the folder on the new machine', async () => {
        there = new FakeMachine();
        there.answer('project.open', ({ folder }) => ({
            summary: projectSummary('shop', 'shop', folder ?? ''),
            document: { version: 3 as const, rev: 1, name: 'shop', color: '#000', views: [] },
            local: { activeViewId: null, views: {} }
        }));
        useEndpoints.getState().add(endpointForAccountMachine(SHOP)!);
        disconnect = connectFakeMachine(there, SHOP.id);
        await act(signIn);
        await until(() => tile()?.disabled === false);
        await clickOn(tile());
        await until(() => everything().includes('Run this on this computer?'));

        expect(shell.picks).toEqual([ACCOUNT.id]);
        expect(everything()).toContain('Ruimte read this from the devcontainer.json in /work/shop.');
        expect(everything()).toContain(`docker exec ${ID} ruimte join account-1`);
        expect(everything()).toContain('Your approval also puts the new machine on your account.');
        expect(shell.starts).toEqual([]);

        shell.started = { ...HELD, candidate: { ...CANDIDATE, state: 'starting', held: undefined } };
        await clickOn(buttonWithText('Approve and start'));
        await until(() => shell.starts.length === 1);

        expect(shell.starts).toEqual([[ID, ACCOUNT.id, 'digest-1']]);

        await tell({
            ...HELD,
            candidate: { ...CANDIDATE, state: 'starting', held: undefined, lines: ['Pull debian:bookworm-slim', 'Status: Downloaded newer image'] }
        });
        await until(() => everything().includes('Starting the machine'));

        expect(everything()).toContain('Status: Downloaded newer image');
        expect(posted).toEqual([]);

        await tell({ ...HELD, machineId: SHOP.id, candidate: { ...CANDIDATE, state: 'joining', join: 'signed', held: undefined } });
        await until(() => there.requests('project.open').length === 1);

        expect(posted).toEqual([REGISTRATION]);
        expect(shell.joined).toEqual([ID]);
        expect(there.requests('project.open')).toEqual([{ folder: '/workspaces/shop', createFolder: false }]);
    });

    test('offers nothing to someone who is not signed in, and says why', async () => {
        await act(async () => usePulsarAccount.setState({ status: 'signed-out', account: null }));
        await until(() => tile() !== null);

        expect(tile()?.disabled).toBe(true);

        await act(async () => useUi.getState().setSettings({ open: true, section: 'machines' }));
        await until(() => everything().includes('Sign in first. The new machine joins the account you are signed in to.'));

        expect(buttonWithText('Choose folder')?.disabled).toBe(true);
        expect(shell.picks).toEqual([]);
    });

    test.each([
        ['Docker is missing', 'Ruimte cannot find Docker on this computer. Install Docker, start it, and try again.'],
        ['the file needs what is not supported', 'Ruimte cannot start .devcontainer/devcontainer.json: it needs "features", which is not supported yet']
    ])('says so when %s, and offers no approval', async (_case, failure) => {
        shell.picked = { ...HELD, candidate: { ...CANDIDATE, state: 'failed', held: undefined, failure } };
        await act(signIn);
        await act(async () => useUi.getState().setSettings({ open: true, section: 'machines' }));
        await until(() => buttonWithText('Choose folder')?.disabled === false);
        await clickOn(buttonWithText('Choose folder'));
        await until(() => everything().includes(failure));

        expect(everything()).toContain('The machine did not start');
        expect(buttonWithText('Approve and start')).toBeNull();
    });

    test('shows a changed file again, and the second yes names what it shows then', async () => {
        await act(signIn);
        await until(() => tile()?.disabled === false);
        await clickOn(tile());
        await until(() => buttonWithText('Approve and start') !== null);

        const changed: DevcontainerStart = {
            ...HELD,
            candidate: {
                ...CANDIDATE,
                held: { digest: 'digest-2', programs: [{ title: 'Pull debian:trixie-slim, unless it is here already', command: 'sh', cwd: '/work/shop' }] }
            }
        };

        shell.started = changed;
        await clickOn(buttonWithText('Approve and start'));
        await until(() => everything().includes('Pull debian:trixie-slim'));
        await clickOn(buttonWithText('Approve and start'));
        await until(() => shell.starts.length === 2);

        expect(shell.starts.map(([, , digest]) => digest)).toEqual(['digest-1', 'digest-2']);
    });
});
