import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ConnectedClient } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID, endpointById } from '@/state/endpoints';
import { mount, until, type Mounted } from '../../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../../testing/fake-machine';
import { MachineClients } from './MachineClients';

const CONNECTED_AT = Date.UTC(2026, 10, 8, 9);

const HERE: ConnectedClient = {
    id: 'client-1',
    access: 'local',
    client: 'desktop',
    version: '0.31.0',
    os: 'macos',
    osVersion: '27',
    device: 'desktop',
    reachability: 'loopback',
    connectedAt: CONNECTED_AT,
    current: true
};

const PHONE: ConnectedClient = {
    id: 'client-2',
    access: 'account',
    label: "Bas's phone",
    client: 'station',
    version: '0.31.0',
    os: 'android',
    osVersion: '16',
    device: 'phone',
    reachability: 'public',
    connectedAt: CONNECTED_AT,
    current: false
};

let machine: FakeMachine;
let clients: ConnectedClient[];
let disconnect: () => void;
let page: Mounted;

function everything(): string {
    return document.body.textContent ?? '';
}

async function show(): Promise<void> {
    page = mount();
    await page.render(<MachineClients endpoint={endpointById(LOCAL_ENDPOINT_ID)!} />);
}

beforeEach(() => {
    clients = [HERE, PHONE];
    machine = new FakeMachine();
    machine.answer('client.list', () => ({ clients }));
    disconnect = connectFakeMachine(machine);
});

afterEach(async () => {
    await page.unmount();
    disconnect();
});

describe('MachineClients', () => {
    test('shows this app and Station on a phone, each with its system, release and reach', async () => {
        await show();
        await until(() => everything().includes('station.ruimte.app'));
        expect(everything()).toContain('Ruimte for Mac');
        expect(everything()).toContain('this device');
        expect(everything()).toContain('macOS 27 · 0.31.0 · This computer');
        expect(everything()).toContain("Bas's phone · Android 16 · 0.31.0 · Internet");
        expect(machine.requests('client.watch')).toHaveLength(1);
    });

    test('an older client that sent nothing of itself says its version is unknown', async () => {
        clients = [HERE, { id: 'client-3', access: 'account', label: 'Old iPhone', reachability: 'lan', connectedAt: CONNECTED_AT, current: false }];
        await show();
        await until(() => everything().includes('Unknown app'));
        expect(everything()).toContain('Old iPhone · Unknown version · Local network');
    });

    test('lists an external MCP client by its name and its last request', async () => {
        clients = [
            HERE,
            { id: 'external-cred-1', access: 'mcp', label: 'claude.ai', client: 'mcp', connectedAt: CONNECTED_AT, lastRequestAt: CONNECTED_AT, current: false }
        ];
        await show();
        await until(() => everything().includes('MCP · claude.ai'));
        expect(everything()).toContain('Last request');
    });

    test('reads the list again when the machine says it changed', async () => {
        clients = [HERE];
        await show();
        await until(() => everything().includes('Ruimte for Mac'));
        expect(everything()).not.toContain('station.ruimte.app');
        clients = [HERE, PHONE];
        machine.emit('client.changed', {});
        await until(() => everything().includes('station.ruimte.app'));
    });

    test('is not drawn for a machine that does not answer client.list', async () => {
        machine.answersOnly(['project.list']);
        await show();
        await until(() => !everything().includes('Connected now'));
        expect(machine.requests('client.list')).toHaveLength(0);
        expect(machine.requests('client.watch')).toHaveLength(0);
    });
});
