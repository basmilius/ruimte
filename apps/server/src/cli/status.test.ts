import { describe, expect, test } from 'bun:test';
import type { MachineStatus } from '@ruimte/contracts';
import { statusLines } from './machine-status.ts';
import { runStatus } from './status.ts';

const STATUS: MachineStatus = {
    version: '0.14.0',
    service: true,
    label: 'droplet',
    onAccount: true,
    broker: { url: 'wss://broker.ruimte.app', connected: true },
    lan: { port: 4220, addresses: ['192.168.1.20', '100.101.102.103'] },
    lanDoorFixed: false
};

const run = async (answer: (input: string, init: RequestInit) => Promise<Response>, port = 4210) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runStatus({
        port,
        home: '/home/ruimte/.ruimte',
        readSecret: async () => 'secret',
        fetch: answer,
        out: (line) => out.push(line),
        err: (line) => err.push(line)
    });
    return { code, out, err };
};

describe('ruimte status', () => {
    test('asks the daemon on the local secret and prints one line per way in', async () => {
        const asked: Array<[string, RequestInit]> = [];
        const { code, out } = await run(async (input, init) => {
            asked.push([input, init]);
            return Response.json(STATUS);
        });
        expect(code).toBe(0);
        const [url, init] = asked[0]!;
        expect(url).toBe('http://127.0.0.1:4210/machine/status');
        expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret');
        expect(out).toEqual([
            'Ruimte 0.14.0 on port 4210, as the background service',
            'Name      droplet',
            'Account   on an account',
            'Broker    wss://broker.ruimte.app, connected',
            'Network   192.168.1.20:4220, 100.101.102.103:4220'
        ]);
    });

    test('a machine nobody can reach from elsewhere says so, and names the way onto an account', () => {
        const lines = statusLines(
            { ...STATUS, service: false, onAccount: false, broker: { url: null, connected: false }, lan: null, lanDoorFixed: true },
            4290
        );
        expect(lines).toEqual([
            'Ruimte 0.14.0 on port 4290, started by hand',
            'Name      droplet',
            'Account   none yet, `ruimte login --port 4290` puts it on yours',
            'Broker    off',
            'Network   closed by --no-lan',
            '',
            'No client elsewhere can reach this machine: the broker is off, and nothing on the local network can reach it either.'
        ]);
        expect(
            statusLines({ ...STATUS, broker: { url: 'wss://broker.ruimte.app', connected: false }, lan: { port: 4220, addresses: [] } }, 4210).slice(3)
        ).toEqual(['Broker    wss://broker.ruimte.app, not connected yet', 'Network   open on port 4220, but this machine has no address on a local network']);
    });

    test('no home, no daemon, another home or an older daemon ends with 1 and a sentence', async () => {
        const out: string[] = [];
        const err: string[] = [];
        const noHome = await runStatus({
            port: 4210,
            home: '/nowhere',
            readSecret: async () => Promise.reject(new Error('ENOENT')),
            out: (line) => out.push(line),
            err: (line) => err.push(line)
        });
        expect(noHome).toBe(1);
        expect(err[0]).toBe('No daemon has started with /nowhere as its home. Start it with `ruimte service install`, or with `ruimte` in another terminal.');

        const down = await run(async () => Promise.reject(new Error('connection refused')), 4290);
        expect(down).toMatchObject({
            code: 1,
            err: ['No daemon answers on port 4290. Start it with `ruimte service install --port 4290`, or with `ruimte --port 4290` in another terminal.']
        });
        expect((await run(async () => new Response('Forbidden', { status: 403 }))).err[0]).toContain('set RUIMTE_HOME');
        expect((await run(async () => new Response('Not found', { status: 404 }))).err[0]).toContain('older than `ruimte status`');
    });
});
