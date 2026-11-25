import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { MachineCandidate } from '@ruimte/contracts';
import { act } from 'react';
import { startPulsarAccount, usePulsarAccount } from '@/pulsar/account';
import { useUi } from '@/state/ui';
import { TransportError } from '@/transport-api/transport';
import { forgetAccountMachines } from '@/workspace/account-machines';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { buttonWithText, everything, installDesktop, removeDesktop } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
const PROJECT_ID = 'project-atlas';
const TARGET = { projectId: PROJECT_ID, extension: 'dev.harbor', source: 'compose-machine', candidate: 'workbench' };
const WORKBENCH: MachineCandidate = {
    source: { extension: 'dev.harbor', id: 'compose-machine', title: 'Harbor' },
    id: 'workbench',
    title: 'workbench',
    place: 'harbor/workbench:1',
    running: false,
    state: 'idle',
    lines: []
};
const HELD: MachineCandidate = {
    ...WORKBENCH,
    state: 'held',
    lines: ['Reading harbor.yaml'],
    held: {
        digest: 'digest-1',
        programs: [
            { title: 'Start workbench', command: "sh -c 'sh scripts/start.sh'", cwd: '/work/atlas', env: { HARBOR_MACHINE: 'workbench' } },
            { join: true, command: 'sh -c \'sh scripts/inside.sh "$@"\' harbor ruimte join account-1', cwd: '/work/atlas' }
        ]
    }
};

const ACCOUNT = { id: 'account-1', provider: 'github' as const, login: 'someone', displayName: null };
const ACCESS_TOKEN = 'a'.repeat(43);
const FAR = Date.UTC(2100, 0, 1);
const REGISTRATION = {
    id: 'workbench',
    name: 'workbench',
    icon: null,
    brokerUrl: 'wss://broker.ruimte.app',
    publicKey: Buffer.from(Uint8Array.from({ length: 32 }, (_value, i) => i)).toString('base64url'),
    issuedAt: 1_000_000,
    signature: 's'.repeat(86)
};
const realFetch = globalThis.fetch;

/* The address book as this window meets it: what was posted to it, and whether it takes a registration. */
interface Book {
    posted: Array<{ authorization: string | null; body: unknown }>;
    listed: number;
    refuses: boolean;
}

/* A person signed in to the account, with an address book that keeps what this window posts. */
async function signIn(): Promise<Book> {
    const book: Book = { posted: [], listed: 0, refuses: false };

    globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
        const path = new URL(input).pathname;

        if (path === '/v1/providers') {
            return Response.json({ providers: ['github'] });
        }

        if (path !== '/v1/machines') {
            return Response.json({ error: { code: 'not-found', message: 'Not found' } }, { status: 404 });
        }

        if (init.method !== 'POST') {
            book.listed += 1;

            return Response.json({ machines: [] });
        }

        book.posted.push({ authorization: new Headers(init.headers).get('authorization'), body: JSON.parse(String(init.body)) });

        if (book.refuses) {
            return Response.json({ error: { code: 'bad-signature', message: 'The signature does not match this machine' } }, { status: 403 });
        }

        const { issuedAt: _issuedAt, signature: _signature, ...listed } = REGISTRATION;

        return Response.json({ machine: { ...listed, lastSeenAt: 1_000_000 } });
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

    return book;
}

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let candidates: MachineCandidate[];

function row(label: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('button')].find((element) => element.textContent?.includes(label)) ?? null;
}

function tell(candidate: MachineCandidate): Promise<void> {
    return act(async () => machine.emit('extension.machineChanged', { projectId: PROJECT_ID, candidate }));
}

/* The window as the app on the computer that runs the machine has it, unless the project is on another machine. */
async function open(thisMachine = true): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} }, {}, { thisMachine });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'machines' }));
}

beforeEach(() => {
    // The desktop app, which is the one client with a machine on its own computer.
    installDesktop();
    machine = new FakeMachine();
    candidates = [WORKBENCH];
    machine.answer('extension.machineList', () => ({ candidates }));
    machine.answer('extension.machineStart', ({ approve }) => ({ candidate: approve === undefined ? HELD : { ...WORKBENCH, state: 'starting' as const } }));
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    workspace.close();
    removeDesktop();
    globalThis.fetch = realFetch;
    await startPulsarAccount(null);
    usePulsarAccount.setState(usePulsarAccount.getInitialState());
    forgetAccountMachines();
});

describe('Settings > Machines with a place an extension can start a machine in', () => {
    test('lists the place under its source, and its detail offers a start', async () => {
        await open();
        await until(() => everything().includes('From Harbor'));

        expect(machine.requests('extension.machineList')).toEqual([{ projectId: PROJECT_ID }]);

        await clickOn(row('workbench'));
        await until(() => everything().includes('Start a machine here'));

        expect(everything()).toContain('harbor/workbench:1, from Harbor');
        expect(everything()).toContain('You see what runs on this computer before anything starts.');
    });

    test('shows what would run and starts only after a yes, which names what was shown', async () => {
        await open();
        await until(() => row('workbench') !== null);
        await clickOn(row('workbench'));
        await clickOn(buttonWithText('Start'));
        await until(() => machine.requests('extension.machineStart').length === 1);
        await tell(HELD);
        await until(() => everything().includes('Run this on this computer?'));

        expect(machine.requests('extension.machineStart')).toEqual([TARGET]);
        expect(everything()).toContain("sh -c 'sh scripts/start.sh'");
        expect(everything()).toContain('In /work/atlas');
        expect(everything()).toContain('Harbor read this from a file in this project.');
        expect(everything()).toContain('Waits for your approval');

        await clickOn(buttonWithText('Approve and start'));
        await until(() => machine.requests('extension.machineStart').length === 2);

        expect(machine.requests('extension.machineStart')[1]).toEqual({ ...TARGET, approve: 'digest-1' });
    });

    test('lets go of a held start on Cancel, and stops one under way', async () => {
        candidates = [HELD];
        await open();
        await until(() => row('workbench') !== null);
        await clickOn(row('workbench'));
        await clickOn(buttonWithText('Cancel'));
        await until(() => machine.requests('extension.machineStop').length === 1);
        await tell({ ...WORKBENCH, state: 'starting', lines: ['Start workbench', 'workbench is up'] });
        await until(() => everything().includes('Starting the machine'));

        expect(everything()).toContain('workbench is up');

        await clickOn(buttonWithText('Stop'));
        await until(() => machine.requests('extension.machineStop').length === 2);
        await tell({ ...WORKBENCH, state: 'stopped' });
        await until(() => everything().includes('Ruimte removed nothing the start had made.'));

        expect(machine.requests('extension.machineStop')).toEqual([TARGET, TARGET]);
    });

    test('says that the approval also puts the new machine on the account', async () => {
        candidates = [HELD];
        await open();
        await until(() => row('workbench') !== null);
        await clickOn(row('workbench'));
        await until(() => everything().includes('Run this on this computer?'));

        expect(everything()).toContain('Put the new machine on your account');
        expect(everything()).toContain('Your approval also puts the new machine on your account.');
    });

    test('posts what the new machine signed with the session of the person, and says that it joined', async () => {
        const book = await signIn();

        machine.answer('extension.machineRegistration', () => ({ registration: REGISTRATION }));
        candidates = [{ ...WORKBENCH, state: 'joining' }];
        await open();
        await until(() => row('workbench') !== null);
        await clickOn(row('workbench'));
        await until(() => everything().includes('Putting the new machine on your account'));

        // Nothing is asked before the new machine signed.
        expect(machine.requests('extension.machineRegistration')).toEqual([]);

        await tell({ ...WORKBENCH, state: 'joining', join: 'signed' });
        await until(() => machine.requests('extension.machineJoined').length === 1);

        expect(machine.requests('extension.machineRegistration')).toEqual([{ ...TARGET, accountId: ACCOUNT.id }]);
        expect(book.posted).toEqual([{ authorization: `Bearer ${ACCESS_TOKEN}`, body: REGISTRATION }]);
        expect(machine.requests('extension.machineJoined')).toEqual([TARGET]);

        await tell({ ...WORKBENCH, state: 'done', join: 'joined' });
        await until(() => everything().includes('It is on your account, in the list of machines.'));
        // The account's own list is read again, which is where the machine shows like any other.
        await until(() => book.listed > 0);
    });

    test('finishes a start another window left signed, as soon as someone looks at the place', async () => {
        const book = await signIn();

        machine.answer('extension.machineRegistration', () => ({ registration: REGISTRATION }));
        candidates = [{ ...WORKBENCH, state: 'joining', join: 'signed' }];
        await open();
        await until(() => row('workbench') !== null);

        expect(book.posted).toEqual([]);

        await clickOn(row('workbench'));
        await until(() => machine.requests('extension.machineJoined').length === 1);

        expect(book.posted).toHaveLength(1);
    });

    test('asks a person who is not signed in to sign in, and posts nothing until then', async () => {
        candidates = [{ ...WORKBENCH, state: 'joining', join: 'signed' }];
        await open();
        await until(() => row('workbench') !== null);
        await clickOn(row('workbench'));
        await until(() => everything().includes('Sign in to put the new machine on your account'));

        expect(everything()).toContain('The machine runs. Sign in to your account in this app, and Ruimte adds it.');
        expect(machine.requests('extension.machineRegistration')).toEqual([]);
        expect(buttonWithText('Stop')).not.toBeNull();
    });

    test('says why a new machine that is on another account did not join', async () => {
        const failure = 'This machine is on another account. Take it off that account first, with `ruimte logout` on this machine.';

        await signIn();
        candidates = [{ ...WORKBENCH, state: 'failed', failure }];
        await open();
        await until(() => row('workbench') !== null);
        await clickOn(row('workbench'));
        await until(() => everything().includes(failure));

        expect(everything()).toContain('The machine did not start');
        expect(machine.requests('extension.machineRegistration')).toEqual([]);
    });

    test('says why the account did not take the registration, and posts a fresh one on Try again', async () => {
        const book = await signIn();

        book.refuses = true;
        machine.answer('extension.machineRegistration', () => ({ registration: REGISTRATION }));
        candidates = [{ ...WORKBENCH, state: 'joining', join: 'signed' }];
        await open();
        await until(() => row('workbench') !== null);
        await clickOn(row('workbench'));
        await until(() => everything().includes('The new machine is not on your account yet'));

        expect(everything()).toContain('The signature does not match this machine');
        expect(machine.requests('extension.machineJoined')).toEqual([]);

        book.refuses = false;
        await clickOn(buttonWithText('Try again'));
        await until(() => machine.requests('extension.machineJoined').length === 1);

        expect(machine.requests('extension.machineRegistration')).toHaveLength(2);
        expect(book.posted).toHaveLength(2);
    });

    test('says so when the machine on this computer is on another account than the person', async () => {
        await signIn();
        machine.answer('extension.machineRegistration', () => {
            throw new TransportError('other-account', 'The machine on this computer is on another account than the one you are signed in to');
        });
        candidates = [{ ...WORKBENCH, state: 'joining', join: 'signed' }];
        await open();
        await until(() => row('workbench') !== null);
        await clickOn(row('workbench'));
        await until(() => everything().includes('The machine on this computer is on another account than the one you are signed in to.'));

        expect(machine.requests('extension.machineJoined')).toEqual([]);
    });

    test('says that a machine without a way on to the account runs, and where it shows once it is on it', async () => {
        await open();
        await until(() => row('workbench') !== null);
        await clickOn(row('workbench'));
        await tell({ ...WORKBENCH, state: 'done' });
        await until(() => everything().includes('The machine runs'));

        expect(everything()).toContain('Once it is on your account, it is in the list of machines.');
    });

    test('says why a start failed, and offers no start where a machine already runs', async () => {
        candidates = [{ ...WORKBENCH, state: 'failed', failure: 'Start workbench ended with code 3' }];
        await open();
        await until(() => row('workbench') !== null);
        await clickOn(row('workbench'));
        await until(() => everything().includes('Start workbench ended with code 3'));

        expect(buttonWithText('Start')).not.toBeNull();

        await tell({ ...WORKBENCH, running: true });
        await until(() => everything().includes('A machine already runs here'));

        expect(buttonWithText('Start')).toBeNull();
    });

    test('lists nothing from a machine that does not answer the request', async () => {
        machine.answersOnly(['project.open', 'client.list']);
        await open();
        await until(() => everything().includes('Machines'));

        expect(machine.requests('extension.machineList')).toEqual([]);
        expect(everything()).not.toContain('From Harbor');
    });

    test('asks no machine but the one on this computer, so a project on another machine lists none', async () => {
        await open(false);
        await until(() => everything().includes('Machines'));

        expect(machine.requests('extension.machineList')).toEqual([]);
        expect(everything()).not.toContain('From Harbor');
    });
});
