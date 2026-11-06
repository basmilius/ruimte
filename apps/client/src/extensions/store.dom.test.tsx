import { afterEach, describe, expect, test } from 'bun:test';
import type { ExtensionInfo } from '@ruimte/contracts';
import { installPack, removeExtension, setExtensionEnabled } from '@/extensions/store';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { TransportError } from '@/transport';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';

const SECOND: Endpoint = {
    id: 'second-machine',
    label: 'Second',
    httpBaseUrl: 'http://127.0.0.1:2',
    wsBaseUrl: 'ws://127.0.0.1:2',
    reachability: 'lan',
    daemonId: null,
    daemonPublicKey: null
};

const ON_MACHINE: ExtensionInfo = {
    manifest: { id: 'acme.counter', name: 'Counter', version: '1.0.0', api: 1 },
    hash: 'abc',
    enabled: true,
    hasServer: true,
    status: 'running'
};

const windowWithBridge = window as unknown as { ruimteDesktop?: unknown };
const before = windowWithBridge.ruimteDesktop;
const releases: (() => void)[] = [];

afterEach(() => {
    for (const release of releases.splice(0)) {
        release();
    }

    windowWithBridge.ruimteDesktop = before;
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useEndpoints.getState().remove(SECOND.id);
});

function machineWith(extensions: ExtensionInfo[], endpointId: string = LOCAL_ENDPOINT_ID): FakeMachine {
    const machine = new FakeMachine();

    machine.answer('extension.list', () => ({ extensions }));
    releases.push(connectFakeMachine(machine, endpointId));

    return machine;
}

/* A shell whose part of a change waits until the test lets it go. */
function slowShell(): { done: () => void } {
    let done = (): void => undefined;
    const waiting = new Promise<void>((resolve) => (done = resolve));

    windowWithBridge.ruimteDesktop = { extensions: { list: async () => [], remove: () => waiting, setEnabled: () => waiting } };

    return { done: () => done() };
}

describe('a change to an installed extension', () => {
    test('goes to the machine in front when it was pressed, also after a switch while the shell removed its part', async () => {
        useEndpoints.getState().add(SECOND);

        const first = machineWith([ON_MACHINE]);
        const second = machineWith([ON_MACHINE], SECOND.id);
        const shell = slowShell();
        const removed = removeExtension('acme.counter');

        useEndpoints.getState().setActive(SECOND.id);
        shell.done();

        expect(await removed).toEqual({ machineFailure: null });
        expect(first.requests('extension.remove')).toEqual([{ id: 'acme.counter' }]);
        expect(second.requests('extension.remove')).toEqual([]);
    });

    test('says when the machine kept its part, and asks nothing of a machine that has no part of it', async () => {
        const machine = machineWith([ON_MACHINE]);

        windowWithBridge.ruimteDesktop = { extensions: { list: async () => [], remove: async () => undefined, setEnabled: async () => undefined } };
        machine.answer('extension.setEnabled', () => {
            throw new TransportError('internal', 'The disk is full');
        });

        expect(await setExtensionEnabled('acme.counter', false)).toEqual({ machineFailure: 'The disk is full' });
        expect(await setExtensionEnabled('acme.elsewhere', false)).toEqual({ machineFailure: null });
        expect(machine.requests('extension.setEnabled')).toEqual([{ id: 'acme.counter', enabled: false }]);
    });

    test('an install the machine refused names its owner, and any other failure keeps its own words', async () => {
        const machine = machineWith([]);
        let refusal = new TransportError('forbidden', 'Only the owner installs here');

        windowWithBridge.ruimteDesktop = { extensions: { list: async () => [], install: async () => undefined } };
        machine.answer('extension.install', () => {
            throw refusal;
        });

        expect(await installPack(new Uint8Array([1]))).toEqual({ onMachine: false, machineFailure: null });

        refusal = new TransportError('internal', 'The disk is full');

        expect(await installPack(new Uint8Array([1]))).toEqual({ onMachine: false, machineFailure: 'The disk is full' });
    });
});
