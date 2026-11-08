import { describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TunnelState } from '@ruimte/contracts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { CloudflareError } from './cloudflare-api.ts';
import { TunnelConfigError } from './tunnel-config.ts';
import { TunnelService, type TunnelPorts } from './tunnel-service.ts';
import { tunnelStore } from './tunnel-store.ts';
import { FakeCloudflare, FakeCloudflared, FAKE_API_TOKEN, FAKE_RUN_TOKEN, MemoryTokenStore, type FakeZone } from './tunnel-test-helpers.ts';

const homeOf = tempHomes('ruimte-tunnels-');

const API_PORT = 4210;
const LISTENER_PORT = 4230;
const MARKER = 'Managed by Ruimte';

interface Fixture {
    service: TunnelService;
    runner: FakeCloudflared;
    cloudflare: FakeCloudflare;
    tokens: MemoryTokenStore;
    home: string;
    bmnw: FakeZone;
    passly: FakeZone;
    state(): Promise<TunnelState>;
    events: { count: number };
    logs: string[];
    listener: { on: boolean };
}

interface Reuse {
    home?: string;
    cloudflare?: FakeCloudflare;
    tokens?: MemoryTokenStore;
}

async function fixture(overrides: Partial<TunnelPorts> = {}, installed: string | null = '/usr/bin/cloudflared', reuse: Reuse = {}): Promise<Fixture> {
    const home = reuse.home ?? (await homeOf());
    const runner = new FakeCloudflared();
    const cloudflare = reuse.cloudflare ?? new FakeCloudflare();
    const tokens = reuse.tokens ?? new MemoryTokenStore();
    const installedBinary = { value: installed };
    const events = { count: 0 };
    const logs: string[] = [];
    const listener = { on: false };
    let counter = 0;

    if (cloudflare.zones.length === 0) {
        cloudflare.zone('bmnw.nl');
        cloudflare.zone('passly.dev');
    }

    const service = new TunnelService({
        store: tunnelStore(home),
        installer: {
            locate: async () => installedBinary.value,
            install: async () => {
                installedBinary.value = '/home/tunnels/bin/cloudflared';

                return installedBinary.value;
            },
            impossible: () => null
        },
        runner,
        tokens,
        cloudflare: cloudflare.fetch,
        machineName: () => 'Bas MacBook',
        machineId: () => 'machine-1',
        deniedPorts: () => [API_PORT, LISTENER_PORT],
        setListener: async (enabled) => {
            listener.on = enabled;

            return enabled ? LISTENER_PORT : null;
        },
        listenerPort: () => (listener.on ? LISTENER_PORT : null),
        clients: () => 2,
        discover: async () => [
            { port: 3000, session: 'Vite' },
            { port: API_PORT, session: null }
        ],
        changed: () => {
            events.count += 1;
        },
        random: (bytes) => String((counter += 1)).padStart(bytes * 2, '0'),
        log: (line) => logs.push(line),
        stopWaitMs: 50,
        ...overrides
    });

    return {
        service,
        runner,
        cloudflare,
        tokens,
        home,
        bmnw: cloudflare.zones.find((zone) => zone.name === 'bmnw.nl')!,
        passly: cloudflare.zones.find((zone) => zone.name === 'passly.dev')!,
        state: () => service.state(),
        events,
        logs,
        listener
    };
}

async function readyTunnel(f: Fixture): Promise<void> {
    await f.service.setToken(FAKE_API_TOKEN);
    await f.service.setup();
    await f.service.idle();
}

function ourTunnel(f: Fixture) {
    return f.cloudflare.tunnels.find((tunnel) => tunnel.name === 'ruimte-bas-macbook-f7a7')!;
}

function hostnamesOf(f: Fixture): unknown[] {
    return ourTunnel(f).ingress.map((rule) => rule.hostname ?? rule.service);
}

describe('the screen states', () => {
    test('shows Install while cloudflared is missing, and goes on to the token once it is installed', async () => {
        const f = await fixture({}, null);

        expect((await f.state()).stage).toBe('not-installed');
        expect((await f.service.install()).stage).toBe('installing');

        await f.service.idle();

        expect(await f.state()).toMatchObject({ stage: 'no-token', hasToken: false });
    });

    test('says what to install where Cloudflare ships no build', async () => {
        const f = await fixture({ installer: { locate: async () => null, install: async () => '', impossible: () => 'Install cloudflared yourself.' } }, null);
        const state = await f.state();

        expect(state.stage).toBe('cannot-install');
        expect(state.message).toBe('Install cloudflared yourself.');
    });

    test('fails an install with the sentence the installer gave, and Try again installs again', async () => {
        let attempts = 0;
        const f = await fixture(
            {
                installer: {
                    locate: async () => (attempts > 1 ? '/x/cloudflared' : null),
                    install: async () => {
                        attempts += 1;

                        if (attempts === 1) {
                            throw new Error('Downloading cloudflared failed.');
                        }

                        return '/x/cloudflared';
                    },
                    impossible: () => null
                }
            },
            null
        );

        await f.service.install();
        await f.service.idle();

        expect(await f.state()).toMatchObject({ stage: 'failed', message: 'Downloading cloudflared failed.' });

        await f.service.retry();
        await f.service.idle();

        expect((await f.state()).stage).toBe('no-token');
    });
});

describe('the API token', () => {
    test('checks the token with Cloudflare, lists the zones with their account and keeps it', async () => {
        const f = await fixture();
        const state = await f.service.setToken(`  ${FAKE_API_TOKEN}\n`);

        expect(f.cloudflare.calls[0]).toMatchObject({ method: 'GET', path: '/user/tokens/verify', authorization: `Bearer ${FAKE_API_TOKEN}` });
        expect(f.cloudflare.called('GET', '/zones')).toHaveLength(1);
        expect(f.tokens.read()).toBe(FAKE_API_TOKEN);
        expect(state).toMatchObject({
            stage: 'no-tunnel',
            hasToken: true,
            account: { id: 'acc-1', name: 'Bas' },
            zones: [
                { id: 'zone-bmnw.nl', name: 'bmnw.nl' },
                { id: 'zone-passly.dev', name: 'passly.dev' }
            ],
            tunnel: null
        });
    });

    test('refuses a token Cloudflare does not accept, and keeps nothing', async () => {
        const f = await fixture();
        const refused = f.service.setToken('typed-wrong-0123456789');

        expect(refused).rejects.toBeInstanceOf(CloudflareError);
        expect(refused).rejects.toMatchObject({ code: 'token-refused' });
        await refused.catch(() => undefined);

        expect(f.tokens.read()).toBeNull();
        expect(await f.state()).toMatchObject({ stage: 'no-token', hasToken: false, zones: [] });
    });

    test('names the permissions when the token may not read zones', async () => {
        const f = await fixture();

        f.cloudflare.failing.set('GET /zones', 403);

        const refused = await f.service.setToken(FAKE_API_TOKEN).catch((e: unknown) => e);

        expect(refused).toMatchObject({ code: 'no-permission' });
        expect((refused as Error).message).toContain('Zone read, DNS edit and Cloudflare Tunnel edit');
        expect(f.tokens.read()).toBeNull();
    });

    test('refuses a token that reaches no domain', async () => {
        const f = await fixture();

        f.cloudflare.zones.length = 0;
        await f.service.setToken(FAKE_API_TOKEN).catch((e: unknown) => expect(e).toMatchObject({ code: 'no-zones' }));

        expect(f.tokens.read()).toBeNull();
    });

    test('forgets the token on request, stops the child and leaves Cloudflare as it is', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();

        const before = f.cloudflare.calls.length;

        expect(f.runner.running).toBe(1);
        expect(await f.service.clearToken()).toMatchObject({ stage: 'no-token', hasToken: false, zones: [] });
        expect(f.runner.running).toBe(0);
        expect(f.tokens.read()).toBeNull();
        expect(f.cloudflare.calls.slice(before)).toEqual([]);
        expect(f.cloudflare.records).toHaveLength(1);
    });

    test('asks for the token before it changes a tunnel', async () => {
        const f = await fixture();

        expect(f.service.setup()).rejects.toMatchObject({ code: 'wrong-stage' });
        expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 })).rejects.toMatchObject({ code: 'no-tunnel' });
    });
});

describe('the tunnel', () => {
    test('makes one dashboard-managed tunnel named after the machine, with a catch-all and nothing running', async () => {
        const f = await fixture();

        await readyTunnel(f);

        expect(f.cloudflare.called('POST', '/accounts/acc-1/cfd_tunnel')[0]!.body).toEqual({ name: 'ruimte-bas-macbook-f7a7', config_src: 'cloudflare' });
        expect(ourTunnel(f).ingress).toEqual([{ service: 'http_status:404' }]);
        expect(await f.state()).toMatchObject({ stage: 'running', tunnel: { name: 'ruimte-bas-macbook-f7a7' }, rows: [] });
        expect(f.runner.running).toBe(0);
    });

    test('asks which account when the token reaches more than one, and keeps the zones of that account', async () => {
        const f = await fixture();

        f.cloudflare.zone('elsewhere.example', { id: 'acc-2', name: 'Studio' });
        await f.service.setToken(FAKE_API_TOKEN);

        expect((await f.state()).account).toBeNull();
        expect(f.service.setup()).rejects.toMatchObject({ code: 'account-required' });

        await f.service.setup('acc-2');
        await f.service.idle();

        expect(await f.state()).toMatchObject({ account: { id: 'acc-2' }, zones: [{ name: 'elsewhere.example' }] });
        expect(f.cloudflare.tunnels[0]!.account).toBe('acc-2');
    });

    test('works with a tunnel it made itself and refuses one of the same name that it did not', async () => {
        const f = await fixture();

        f.cloudflare.tunnel('acc-1', 'ruimte-bas-macbook-f7a7', [{ hostname: 'old.bmnw.nl', service: 'http://localhost:1' }]);
        await f.service.setToken(FAKE_API_TOKEN);
        await f.service.setup();
        await f.service.idle();

        expect(await f.state()).toMatchObject({ stage: 'failed' });
        expect((await f.state()).message).toContain('has a tunnel named ruimte-bas-macbook-f7a7 already');
        expect((await f.state()).message).toContain('may belong to another machine');
        expect(f.cloudflare.tunnels).toHaveLength(1);
        expect(f.cloudflare.tunnels[0]!.ingress).toEqual([{ hostname: 'old.bmnw.nl', service: 'http://localhost:1' }]);
    });

    test('gives two machines with the same name a tunnel each on one account', async () => {
        const first = await fixture();
        const second = await fixture({ machineId: () => 'machine-2' }, '/usr/bin/cloudflared', { cloudflare: first.cloudflare });

        await readyTunnel(first);
        await readyTunnel(second);

        expect(first.cloudflare.tunnels.map((tunnel) => tunnel.name)).toEqual(['ruimte-bas-macbook-f7a7', 'ruimte-bas-macbook-d934']);
        expect((await second.state()).stage).toBe('running');
    });

    test('forgets a tunnel that was deleted in the dashboard and says its records stay', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();
        f.cloudflare.tunnels.length = 0;
        await f.service.retry();
        await f.service.idle();

        expect(await f.state()).toMatchObject({ stage: 'failed', tunnel: null, rows: [] });
        expect((await f.state()).message).toContain('DNS records are still in Cloudflare');
        expect(f.cloudflare.records).toHaveLength(1);
        expect(f.runner.running).toBe(0);
    });
});

describe('a row', () => {
    test('puts a hostname on each of two zones: a label in one, a full hostname in the other', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'Shop', port: 3000 });
        await f.service.idle();
        await f.service.add({ kind: 'dev', zone: f.passly.id, label: 'api-tunnel.passly.dev', port: 3001 });
        await f.service.idle();

        const target = `${ourTunnel(f).id}.cfargotunnel.com`;

        expect(f.cloudflare.records.map((record) => [record.zone, record.type, record.name, record.content, record.proxied, record.comment])).toEqual([
            ['zone-bmnw.nl', 'CNAME', 'shop.bmnw.nl', target, true, MARKER],
            ['zone-passly.dev', 'CNAME', 'api-tunnel.passly.dev', target, true, MARKER]
        ]);
        expect(ourTunnel(f).ingress).toEqual([
            { hostname: 'shop.bmnw.nl', service: 'http://127.0.0.1:3000' },
            { hostname: 'api-tunnel.passly.dev', service: 'http://127.0.0.1:3001' },
            { service: 'http_status:404' }
        ]);
        expect((await f.state()).rows.map((row) => row.hostname)).toEqual(['shop.bmnw.nl', 'api-tunnel.passly.dev']);
    });

    test('runs one cloudflared for the whole tunnel, with the run token in its environment and not on its command line', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();
        await f.service.add({ kind: 'dev', zone: f.passly.id, label: 'b', port: 3001 });
        await f.service.idle();

        // Cloudflare pushes a changed ingress to the running connector, so a second row restarts nothing.
        expect(f.runner.calls).toEqual([['tunnel', '--no-autoupdate', 'run']]);
        expect(f.runner.environments).toEqual([{ TUNNEL_TOKEN: FAKE_RUN_TOKEN }]);
        expect(f.runner.running).toBe(1);
        expect(f.cloudflare.called('GET', `/accounts/acc-1/cfd_tunnel/${ourTunnel(f).id}/token`)).toHaveLength(1);
    });

    test('refuses a name that has a record Ruimte did not make, and writes nothing', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const foreign = f.cloudflare.record(f.bmnw, { name: 'app.bmnw.nl', type: 'A', content: '203.0.113.9' });
        const before = f.cloudflare.calls.length;
        const refused = await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'app', port: 3000 }).catch((e: unknown) => e);

        expect(refused).toBeInstanceOf(TunnelConfigError);
        expect(refused).toMatchObject({ code: 'foreign-record' });
        expect((refused as Error).message).toContain('app.bmnw.nl already has a DNS record of type A pointing at 203.0.113.9 that Ruimte did not make');
        expect(f.cloudflare.calls.slice(before).map((call) => call.method)).toEqual(['GET']);
        expect(f.cloudflare.records).toEqual([foreign]);
        expect(ourTunnel(f).ingress).toEqual([{ service: 'http_status:404' }]);
        expect((await f.state()).stage).toBe('running');
        expect(f.runner.running).toBe(0);
    });

    test('refuses a CNAME to the same tunnel that the dashboard made, since Ruimte did not make it', async () => {
        const f = await fixture();

        await readyTunnel(f);
        f.cloudflare.record(f.bmnw, { name: 'app.bmnw.nl', type: 'CNAME', content: `${ourTunnel(f).id}.cfargotunnel.com`, comment: 'by hand' });

        expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'app', port: 3000 })).rejects.toMatchObject({ code: 'foreign-record' });
    });

    test('updates a record it made earlier instead of making a second one', async () => {
        const f = await fixture();

        await readyTunnel(f);
        f.cloudflare.record(f.bmnw, { name: 'app.bmnw.nl', type: 'CNAME', content: `${ourTunnel(f).id}.cfargotunnel.com`, comment: MARKER, proxied: false });
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'app', port: 3000 });
        await f.service.idle();

        expect(f.cloudflare.records).toHaveLength(1);
        expect(f.cloudflare.records[0]).toMatchObject({ proxied: true });
        expect(f.cloudflare.called('PUT', '/zones/zone-bmnw.nl/dns_records/')).toHaveLength(1);
        expect(f.cloudflare.called('POST', '/zones/')).toHaveLength(0);
    });

    test('refuses a hostname that belongs to the other zone, the apex and a name that is none', async () => {
        const f = await fixture();

        await readyTunnel(f);

        expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'x.passly.dev', port: 3000 })).rejects.toMatchObject({ code: 'wrong-zone' });
        expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'bmnw.nl', port: 3000 })).rejects.toMatchObject({ code: 'apex' });
        expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a b', port: 3000 })).rejects.toMatchObject({ code: 'invalid-hostname' });
        expect(f.service.add({ kind: 'dev', zone: 'zone-unknown', label: 'a', port: 3000 })).rejects.toMatchObject({ code: 'unknown-zone' });
        expect(f.cloudflare.called('POST', '/zones/')).toHaveLength(0);
    });

    test('never points at the API port or the listener from a dev row', async () => {
        const f = await fixture();

        await readyTunnel(f);

        for (const port of [API_PORT, LISTENER_PORT]) {
            expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: `p${port}`, port })).rejects.toMatchObject({ code: 'port-denied' });
        }

        expect(f.cloudflare.records).toHaveLength(0);
    });

    test('puts the MCP row on the listener only while the listener is on', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'mcp', zone: f.passly.id, label: 'mcp-secret-tunnel' });
        await f.service.idle();

        expect(hostnamesOf(f)).toEqual(['http_status:404']);

        await f.service.setMcp(true);
        await f.service.idle();

        expect(ourTunnel(f).ingress).toContainEqual({ hostname: 'mcp-secret-tunnel.passly.dev', service: `http://127.0.0.1:${LISTENER_PORT}` });

        await f.service.setMcp(false);
        await f.service.idle();

        expect(hostnamesOf(f)).toEqual(['http_status:404']);
        expect(f.listener.on).toBe(false);
    });

    test('refuses a second MCP row and a duplicate hostname', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'mcp', zone: f.bmnw.id, label: 'one' });
        await f.service.idle();

        expect(f.service.add({ kind: 'mcp', zone: f.bmnw.id, label: 'two' })).rejects.toMatchObject({ code: 'mcp-exists' });
        expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'one.bmnw.nl', port: 3000 })).rejects.toMatchObject({ code: 'hostname-taken' });
    });

    test('switches a hostname off and on in Cloudflare, and stops the child when none is on', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();

        const row = (await f.state()).rows[0]!;

        await f.service.update(row.id, { enabled: false });
        await f.service.idle();

        expect(hostnamesOf(f)).toEqual(['http_status:404']);
        expect(f.cloudflare.records).toHaveLength(1);
        expect(f.runner.running).toBe(0);

        await f.service.update(row.id, { enabled: true });
        await f.service.idle();

        expect(hostnamesOf(f)).toEqual(['a.bmnw.nl', 'http_status:404']);
        expect(f.runner.running).toBe(1);
    });
});

describe('removal', () => {
    test('deletes the record and the rule it made, and nothing else of the account', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const stranger = f.cloudflare.record(f.bmnw, { name: 'www.bmnw.nl', type: 'CNAME', content: 'shop.example.net' });
        const other = f.cloudflare.tunnel('acc-1', 'office', [{ hostname: 'nas.bmnw.nl', service: 'http://nas:80' }, { service: 'http_status:404' }]);

        ourTunnel(f).ingress = [{ hostname: 'docs.bmnw.nl', service: 'http://localhost:8080' }, { service: 'http_status:404' }];
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();
        await f.service.add({ kind: 'dev', zone: f.passly.id, label: 'b', port: 3001 });
        await f.service.idle();
        await f.service.remove((await f.state()).rows[0]!.id);
        await f.service.idle();

        expect(f.cloudflare.records.map((record) => record.name)).toEqual(['www.bmnw.nl', 'b.passly.dev']);
        expect(f.cloudflare.records[0]).toBe(stranger);
        expect(ourTunnel(f).ingress).toEqual([
            { hostname: 'docs.bmnw.nl', service: 'http://localhost:8080' },
            { hostname: 'b.passly.dev', service: 'http://127.0.0.1:3001' },
            { service: 'http_status:404' }
        ]);
        expect(other.ingress).toHaveLength(2);
        expect((await f.state()).rows.map((row) => row.hostname)).toEqual(['b.passly.dev']);
        expect(f.runner.running).toBe(1);

        await f.service.remove((await f.state()).rows[0]!.id);
        await f.service.idle();

        expect(f.runner.running).toBe(0);
        expect(f.cloudflare.called('DELETE', '/zones/')).toHaveLength(2);
    });

    test('leaves a record alone that a person since pointed somewhere else', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();
        f.cloudflare.records[0]!.content = 'elsewhere.example.net';
        await f.service.remove((await f.state()).rows[0]!.id);
        await f.service.idle();

        expect(f.cloudflare.records).toHaveLength(1);
        expect(f.cloudflare.called('DELETE', '/zones/')).toHaveLength(0);
        expect((await f.state()).rows).toEqual([]);
    });

    test('touches no tunnel but its own', async () => {
        const f = await fixture();
        const other = f.cloudflare.tunnel('acc-1', 'office');

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();
        await f.service.remove((await f.state()).rows[0]!.id);
        await f.service.idle();

        const writes = f.cloudflare.calls.filter((call) => call.method !== 'GET' && call.path.includes('cfd_tunnel'));

        expect(
            writes.every((call) => call.path.startsWith(`/accounts/acc-1/cfd_tunnel/${ourTunnel(f).id}/`) || call.path === '/accounts/acc-1/cfd_tunnel')
        ).toBe(true);
        expect(f.cloudflare.calls.some((call) => call.path.includes(other.id))).toBe(false);
        expect(other.ingress).toEqual([{ service: 'http_status:404' }]);
    });
});

describe('after a restart', () => {
    test('defaults the MCP to come back on and a dev server to stay off', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'mcp', zone: f.bmnw.id, label: 'one' });
        await f.service.idle();
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'two', port: 3000 });
        await f.service.idle();

        const rows = (await f.state()).rows;

        expect(rows.find((row) => row.kind === 'mcp')?.comeBack).toBe(true);
        expect(rows.find((row) => row.kind === 'dev')?.comeBack).toBe(false);
    });

    test('brings back only the rows that come back, takes the others out of Cloudflare and checks the deny list again', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.setMcp(true);
        await f.service.idle();
        await f.service.add({ kind: 'mcp', zone: f.bmnw.id, label: 'one' });
        await f.service.idle();
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'two', port: 3000 });
        await f.service.idle();
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'three', port: 3001, comeBack: true });
        await f.service.idle();
        await f.service.stop();

        const again = await fixture({}, '/usr/bin/cloudflared', { home: f.home, cloudflare: f.cloudflare, tokens: f.tokens });

        await again.service.resume();
        await again.service.idle();

        const state = await again.state();

        expect(state.rows.map((row) => [row.hostname, row.enabled])).toEqual([
            ['one.bmnw.nl', true],
            ['two.bmnw.nl', false],
            ['three.bmnw.nl', true]
        ]);
        expect(state.zones.map((zone) => zone.name)).toEqual(['bmnw.nl', 'passly.dev']);
        expect(hostnamesOf(again)).toEqual(['one.bmnw.nl', 'three.bmnw.nl', 'http_status:404']);
        expect(again.runner.running).toBe(1);

        // A row that was off goes on again only if its port is still not Ruimte's own.
        expect(again.service.update(state.rows[1]!.id, { enabled: true })).resolves.toBeDefined();
        expect(again.service.update(state.rows[1]!.id, { comeBack: true })).resolves.toBeDefined();
    });

    test('says so when Cloudflare cannot be reached at boot, and the screen offers Try again', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000, comeBack: true });
        await f.service.idle();
        await f.service.stop();

        const again = await fixture({ cloudflare: async () => Promise.reject(new Error('offline')) }, '/usr/bin/cloudflared', {
            home: f.home,
            tokens: f.tokens
        });

        await again.service.resume();
        await again.service.idle();

        expect(await again.state()).toMatchObject({ stage: 'failed' });
        expect((await again.state()).message).toContain('Ruimte could not reach Cloudflare');
    });

    test('leaves a child that will not stop running and says so', async () => {
        const f = await fixture();

        await readyTunnel(f);

        // The fake ends a child when asked; this one ignores the request.
        const original = f.runner.start.bind(f.runner);

        f.runner.start = (binary, args, onLine, env) => {
            const process = original(binary, args, onLine, env);

            return { exited: process.exited, stop: () => undefined };
        };
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();
        await f.service.update((await f.state()).rows[0]!.id, { enabled: false });
        await f.service.idle();

        expect((await f.state()).stage).toBe('failed');
        expect((await f.state()).message).toContain('did not stop when asked');
    });

    test('reports a crashed child as a failure with its last sentence', async () => {
        const f = await fixture();

        await readyTunnel(f);
        f.runner.answer('run', { lines: ['2026-11-08T10:00:00Z ERR Unable to reach the origin service'] });
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();
        f.runner.crash();
        await Promise.resolve();

        expect(await f.state()).toMatchObject({ stage: 'failed', message: 'Unable to reach the origin service' });
    });
});

describe('what the section reads and offers', () => {
    test('offers the discovered ports without Ruimte own ports and those already on the tunnel', async () => {
        const f = await fixture();

        await readyTunnel(f);
        expect(await f.service.discover()).toEqual([{ port: 3000, session: 'Vite' }]);

        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();

        expect(await f.service.discover()).toEqual([]);
    });

    test('counts the connected clients and tells every client when the state moved', async () => {
        const f = await fixture();

        await readyTunnel(f);

        expect((await f.state()).clients).toBe(2);
        expect(f.events.count).toBeGreaterThan(0);
    });

    test('offers a long random label for the MCP row once there is a tunnel', async () => {
        const f = await fixture();

        await f.service.setToken(FAKE_API_TOKEN);

        expect((await f.state()).suggestedMcpLabel).toBeNull();

        await f.service.setup();
        await f.service.idle();

        expect((await f.state()).suggestedMcpLabel).toMatch(/^mcp-[0-9]+$/);
    });
});

describe('an old tunnels.json', () => {
    test('starts empty and keeps whether the external MCP was on', async () => {
        const home = await homeOf();

        await mkdir(join(home, 'tunnels'), { recursive: true });
        await writeFile(
            join(home, 'tunnels', 'tunnels.json'),
            JSON.stringify({
                version: 1,
                signedIn: true,
                domain: 'example.com',
                tunnel: { id: 'x', name: 'ruimte-x', credentialsFile: '/home/me/.cloudflared/x.json' },
                mcp: { enabled: true, label: 'mcp-1' },
                rows: [{ id: 'a', kind: 'dev', hostname: 'a.example.com', port: 3000, enabled: true, comeBack: false }]
            })
        );

        const f = await fixture({}, '/usr/bin/cloudflared', { home });

        expect(await f.state()).toMatchObject({ stage: 'no-token', tunnel: null, rows: [], mcp: { enabled: true } });
    });

    test('starts empty for a file that is no tunnels file at all', async () => {
        const home = await homeOf();

        await mkdir(join(home, 'tunnels'), { recursive: true });
        await writeFile(join(home, 'tunnels', 'tunnels.json'), '{"version":7,"rows":"?"}');

        const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
        const f = await fixture({}, '/usr/bin/cloudflared', { home });

        warn.mockRestore();

        expect(await f.state()).toMatchObject({ stage: 'no-token', tunnel: null, rows: [] });
    });
});

describe('token handling', () => {
    test('sends the token to Cloudflare in a header and nowhere else', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();

        expect(f.cloudflare.calls.length).toBeGreaterThan(5);

        for (const call of f.cloudflare.calls) {
            expect(call.authorization).toBe(`Bearer ${FAKE_API_TOKEN}`);
            expect(JSON.stringify({ path: call.path, body: call.body })).not.toContain(FAKE_API_TOKEN);
        }
    });

    test('keeps neither token in the state, the saved file, the events, the logs or the command line', async () => {
        const f = await fixture();

        await readyTunnel(f);
        f.runner.answer('run', { lines: [`2026-11-08T10:00:00Z ERR connection with ${FAKE_RUN_TOKEN} and ${FAKE_API_TOKEN} was refused`] });
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();
        f.runner.crash();
        await Promise.resolve();

        const state = JSON.stringify(await f.state());
        const saved = await readFile(join(f.home, 'tunnels', 'tunnels.json'), 'utf8');
        const everything = [state, saved, f.logs.join('\n'), JSON.stringify(f.runner.calls)].join('\n');

        expect(everything).not.toContain(FAKE_API_TOKEN);
        expect(everything).not.toContain(FAKE_RUN_TOKEN);
        expect(JSON.parse(state)).toMatchObject({ hasToken: true, message: 'connection with [token] and [token] was refused' });
    });

    test('keeps no token of Cloudflare in what it says about a refusal', async () => {
        const f = await fixture();

        f.cloudflare.acceptedToken = 'another-token-0123456789';

        const refused = await f.service.setToken(FAKE_API_TOKEN).catch((e: unknown) => e);

        expect((refused as Error).message).not.toContain(FAKE_API_TOKEN);
        expect(f.logs.join('\n')).not.toContain(FAKE_API_TOKEN);
    });
});

describe('Cloudflare credentials', () => {
    test('no code of the tunnels folder reads cert.pem or a credentials file, runs login or route, or puts a token on a command line', async () => {
        const folder = import.meta.dir;
        const sources = await Promise.all(
            [...new Bun.Glob('*.ts').scanSync(folder)]
                .filter((name) => !name.endsWith('.test.ts') && name !== 'tunnel-test-helpers.ts')
                .map(async (name) => ({ name, text: await readFile(join(folder, name), 'utf8') }))
        );
        const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        const hits = (pattern: RegExp, only?: (name: string) => boolean): string[] =>
            sources.filter(({ name, text }) => (only?.(name) ?? true) && pattern.test(code(text))).map(({ name }) => name);

        expect(hits(/cert\.pem|credentials-file|credentialsFile|\.cloudflared/)).toEqual([]);
        expect(hits(/['"]login['"]|['"]route['"]|['"]dns['"]|tunnel['",\s]+token/)).toEqual([]);
        // The token reaches Cloudflare in one file, which builds every address itself.
        expect(hits(/api\.cloudflare\.com/)).toEqual(['cloudflare-api.ts']);
        // The files that read the disk read what Ruimte wrote itself: the credential store its own file, the token store its own.
        expect(hits(/readFile|createReadStream|\bopen\(/, (name) => name !== 'credential-store.ts' && name !== 'cloudflare-token-store.ts')).toEqual([]);
        expect(sources.find(({ name }) => name === 'credential-store.ts')?.text).toContain("'credentials.json'");
        expect(sources.find(({ name }) => name === 'cloudflare-token-store.ts')?.text).toContain("'cloudflare-token'");
        // The run token is an environment variable of the child, and the arguments are fixed words.
        expect(hits(/TUNNEL_TOKEN/)).toEqual(['tunnel-service.ts']);
        expect(sources.find(({ name }) => name === 'tunnel-service.ts')?.text).toContain("['tunnel', '--no-autoupdate', 'run']");
    });
});
