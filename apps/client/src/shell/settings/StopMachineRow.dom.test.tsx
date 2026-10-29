import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { RequestType } from '@ruimte/contracts';
import type { MachineStopPreview } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { clickOn, mount, until, type Mounted } from '../../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../../testing/fake-machine';
import { machineBridge } from '../../../testing/machine-bridge';
import { buttonWithText, everything, installDesktop, removeDesktop } from '../../../testing/dom-helpers';
import { StopMachineRow } from './StopMachineRow';

const BUSY: MachineStopPreview = { work: { agents: 2, terminals: 0 }, home: '~/.ruimte', commandLine: false };

let page: Mounted;
let order: string[];
let preview: Promise<MachineStopPreview>;
let previewFails: boolean;
let release: (() => void) | null;

/* What a person clicks: the words beside the box. */
function boxLabel(): HTMLElement | null {
    return box()?.closest('label') ?? null;
}

function box(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="checkbox"]');
}

async function open(choose: () => Promise<void> = async () => void order.push('choose')): Promise<void> {
    installDesktop({ machine: machineBridge('local', { stopPreview: () => (previewFails ? Promise.reject(new Error('no answer')) : preview), choose }) });
    page = mount();
    await page.render(<StopMachineRow />);
    await clickOn(buttonWithText('Stop using…'));
}

beforeEach(() => {
    order = [];
    preview = Promise.resolve(BUSY);
    previewFails = false;
    release = null;
    useServers.getState().setAccount(LOCAL_ENDPOINT_ID, 'account-1');
});

afterEach(async () => {
    await page.unmount();
    release?.();
    useServers.getState().setAccount(LOCAL_ENDPOINT_ID, null);
    removeDesktop();
});

function connect(failLeave = false): FakeMachine {
    const machine = new FakeMachine();
    // What the machine says about itself on connecting overwrites the account a test set by hand.
    const request = machine.request.bind(machine);
    machine.request = (async (type: RequestType, payload: never) => {
        const result = await request(type, payload);
        return type === 'endpoint.info' ? { ...(result as object), accountId: useServers.getState().byEndpoint[LOCAL_ENDPOINT_ID]?.accountId ?? null } : result;
    }) as typeof machine.request;
    machine.answer('endpoint.leaveAccount', async () => {
        order.push('leave');
        if (failLeave) {
            throw new Error('the account refused');
        }
        return { revoked: 0 };
    });
    release = connectFakeMachine(machine);
    return machine;
}

describe('stopping the machine this app runs', () => {
    test('names what ends and where the data stays, and sends none', async () => {
        connect();
        await open();
        await until(() => everything().includes('2 agents end now.'));
        expect(everything()).toContain('stay in ~/.ruimte');
        await clickOn(buttonWithText('Stop and restart'));
        await until(() => order.length > 0);
        expect(order).toEqual(['choose']);
    });

    test('waits for the machine to say what runs before it can be confirmed', async () => {
        connect();
        let answer: (value: MachineStopPreview) => void = () => undefined;
        preview = new Promise((resolve) => (answer = resolve));
        await open();
        expect(everything()).toContain('Checking what is running…');
        expect(buttonWithText('Stop and restart')?.disabled).toBe(true);
        answer({ work: { agents: 0, terminals: 0 }, home: '~/.ruimte', commandLine: false });
        await until(() => everything().includes('No agents or terminals are running.'));
        expect(buttonWithText('Stop and restart')?.disabled).toBe(false);
    });

    test('takes the machine off the account first when asked', async () => {
        connect();
        await open();
        await until(() => box() !== null);
        expect(box()?.getAttribute('aria-checked')).toBe('false');
        await clickOn(boxLabel());
        await clickOn(buttonWithText('Stop and restart'));
        await until(() => order.length === 2);
        expect(order).toEqual(['leave', 'choose']);
    });

    test('an account that refuses keeps the question open and stops nothing', async () => {
        connect(true);
        await open();
        await until(() => box() !== null);
        await clickOn(boxLabel());
        await clickOn(buttonWithText('Stop and restart'));
        await until(() => everything().includes('the account refused'));
        expect(order).toEqual(['leave']);
        expect(everything()).toContain('Stop using this computer as a machine?');
    });

    test('a machine that cannot be reached stays on the account, and says so', async () => {
        await open();
        await until(() => box() !== null);
        expect(box()?.hasAttribute('disabled') || box()?.getAttribute('aria-disabled') === 'true').toBe(true);
        expect(everything()).toContain('This machine is not answering, so it stays on your account.');
    });

    test('a machine from the command line is left running, and the checkbox is not offered without an account', async () => {
        useServers.getState().setAccount(LOCAL_ENDPOINT_ID, null);
        connect();
        preview = Promise.resolve({ work: null, home: '~/.ruimte', commandLine: true });
        await open();
        await until(() => everything().includes('keeps running'));
        expect(box()).toBeNull();
    });

    test('a machine that cannot say what runs still gets its question, with no path in it', async () => {
        connect();
        previewFails = true;
        await open();
        await until(() => everything().includes('stay on this computer'));
        expect(everything()).not.toContain('~/.ruimte');
        expect(buttonWithText('Stop and restart')?.disabled).toBe(false);
    });

    test('a failure of the shell itself is told in our own words', async () => {
        connect();
        await open(() => Promise.reject(new Error("Error invoking remote method 'machine:choose': Error: EACCES")));
        await until(() => buttonWithText('Stop and restart') !== null);
        await clickOn(buttonWithText('Stop and restart'));
        await until(() => everything().includes('Ruimte could not restart without a machine. Try again.'));
        expect(everything()).not.toContain('Error invoking');
    });
});
