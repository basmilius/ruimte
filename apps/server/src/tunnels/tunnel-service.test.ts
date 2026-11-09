import { describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TunnelStateSchema, type TunnelState } from '@ruimte/contracts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { CloudflareError } from './cloudflare-api.ts';
import { TunnelConfigError } from './tunnel-config.ts';
import { TunnelService, type TunnelPorts } from './tunnel-service.ts';
import { tunnelStore } from './tunnel-store.ts';
import { FakeCloudflare, FakeCloudflared, FAKE_API_TOKEN, FAKE_RUN_TOKEN, MemoryTokenStore, type FakeZone } from './tunnel-test-helpers.ts';

const homeOf = tempHomes('ruimte-tunnels-');

const API_PORT = 4210;
const LISTENER_PORT = 4230;
// The mark is the same piece of the machine id that ends the tunnel's name.
const MARKER = 'Managed by Ruimte · f7a7';

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
        expect(await f.state()).toMatchObject({ stage: 'running', tunnel: { name: 'ruimte-bas-macbook-f7a7', created: true, runner: null }, rows: [] });
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

    test('keeps a tunnel on an account the new token does not reach, and says so', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();
        f.cloudflare.zones.splice(0);
        f.cloudflare.zone('work.dev', { id: 'acc-2', name: 'Work' });
        await f.service.setToken(FAKE_API_TOKEN);
        await f.service.idle();

        const state = await f.state();

        expect(state).toMatchObject({ stage: 'failed', tunnel: { name: 'ruimte-bas-macbook-f7a7' }, rows: [{ hostname: 'shop.bmnw.nl' }] });
        expect(state.message).toContain('does not reach that account');
        expect(f.cloudflare.tunnels).toHaveLength(1);
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
        expect(f.cloudflare.calls.slice(before).filter((call) => call.method !== 'GET')).toEqual([]);
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

    test('refuses a record that Ruimte on another machine made for the same tunnel, and leaves it alone', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const theirs = f.cloudflare.record(f.bmnw, {
            name: 'app.bmnw.nl',
            type: 'CNAME',
            content: `${ourTunnel(f).id}.cfargotunnel.com`,
            comment: 'Managed by Ruimte · 0b1c',
            proxied: true
        });
        const refused = await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'app', port: 3000 }).catch((e: unknown) => e);

        expect(refused).toMatchObject({ code: 'other-machine', message: 'app.bmnw.nl belongs to Ruimte on another computer. Pick another name.' });
        expect(f.cloudflare.records).toEqual([theirs]);
        expect(ourTunnel(f).ingress).toEqual([{ service: 'http_status:404' }]);
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

        expect(ourTunnel(f).ingress).toEqual([{ hostname: 'mcp-secret-tunnel.passly.dev', service: 'http_status:404' }, { service: 'http_status:404' }]);

        await f.service.setMcp(true);
        await f.service.idle();

        expect(ourTunnel(f).ingress).toContainEqual({ hostname: 'mcp-secret-tunnel.passly.dev', service: `http://127.0.0.1:${LISTENER_PORT}` });

        await f.service.setMcp(false);
        await f.service.idle();

        expect(ourTunnel(f).ingress).toEqual([{ hostname: 'mcp-secret-tunnel.passly.dev', service: 'http_status:404' }, { service: 'http_status:404' }]);
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

        expect(ourTunnel(f).ingress).toEqual([{ hostname: 'a.bmnw.nl', service: 'http_status:404' }, { service: 'http_status:404' }]);
        expect(f.cloudflare.records).toHaveLength(1);
        expect(f.runner.running).toBe(0);

        await f.service.update(row.id, { enabled: true });
        await f.service.idle();

        expect(hostnamesOf(f)).toEqual(['a.bmnw.nl', 'http_status:404']);
        expect(f.runner.running).toBe(1);
    });

    test('keeps a hostname on that Cloudflare would not take off, says why and keeps the child that serves it', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();

        const row = (await f.state()).rows[0]!;

        f.cloudflare.failing.set('PUT /accounts/acc-1/cfd_tunnel', 500);

        await expect(f.service.update(row.id, { enabled: false })).rejects.toBeInstanceOf(CloudflareError);

        await f.service.idle();

        const state = await f.state();

        expect(state.stage).toBe('failed');
        expect(state.message).toContain("Saving the tunnel's hostnames failed");
        expect(state.rows[0]!.enabled).toBe(true);
        expect(hostnamesOf(f)).toEqual(['a.bmnw.nl', 'http_status:404']);
        expect(f.runner.running).toBe(1);
    });

    test('keeps a new hostname off that Cloudflare would not put on the tunnel, so Try again does not publish it', async () => {
        const f = await fixture();

        await readyTunnel(f);
        // Cloudflare takes the 404 that holds the name and turns down the rule that would serve it.
        f.cloudflare.writers.push(() => f.cloudflare.failing.set('PUT /accounts/acc-1/cfd_tunnel', 403));

        await expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000, comeBack: true })).rejects.toBeInstanceOf(CloudflareError);

        await f.service.idle();
        f.cloudflare.failing.clear();

        expect((await f.state()).rows).toMatchObject([{ hostname: 'a.bmnw.nl', enabled: false }]);

        await f.service.retry();
        await f.service.idle();

        expect(hostnamesOf(f)).toEqual(['a.bmnw.nl', 'http_status:404']);
        expect(ourTunnel(f).ingress[0]).toEqual({ hostname: 'a.bmnw.nl', service: 'http_status:404' });
        expect(f.runner.running).toBe(0);

        await f.service.remove((await f.state()).rows[0]!.id);
        await f.service.idle();

        expect(f.cloudflare.records).toHaveLength(0);
    });

    test('leaves the rules of the dashboard on a hostname of its own with a path, and the catch-all it set, holding the name with a 404 once off', async () => {
        const f = await fixture();

        await readyTunnel(f);
        ourTunnel(f).ingress = [{ hostname: 'a.bmnw.nl', path: '/api', service: 'http://localhost:9000' }, { service: 'http_status:503' }];
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();

        expect(ourTunnel(f).ingress).toEqual([
            { hostname: 'a.bmnw.nl', path: '/api', service: 'http://localhost:9000' },
            { hostname: 'a.bmnw.nl', service: 'http://127.0.0.1:3000' },
            { service: 'http_status:503' }
        ]);

        await f.service.update((await f.state()).rows[0]!.id, { enabled: false });
        await f.service.idle();

        expect(ourTunnel(f).ingress).toEqual([
            { hostname: 'a.bmnw.nl', path: '/api', service: 'http://localhost:9000' },
            { hostname: 'a.bmnw.nl', service: 'http_status:404' },
            { service: 'http_status:503' }
        ]);
    });
});

describe('the origin of a dev row', () => {
    test('sends a host header to a plain http server, with a port or without', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 80, origin: { hostHeader: ' Passly.Test ' } });
        await f.service.add({
            kind: 'dev',
            zone: f.bmnw.id,
            label: 'b',
            port: 8080,
            origin: { https: false, hostHeader: 'localhost:8080', noTlsVerify: false }
        });
        await f.service.idle();

        expect(ourTunnel(f).ingress).toEqual([
            { hostname: 'a.bmnw.nl', service: 'http://127.0.0.1:80', originRequest: { httpHostHeader: 'passly.test' } },
            { hostname: 'b.bmnw.nl', service: 'http://127.0.0.1:8080', originRequest: { httpHostHeader: 'localhost:8080' } },
            { service: 'http_status:404' }
        ]);
        expect((await f.state()).rows.map((row) => row.origin)).toEqual([{ hostHeader: 'passly.test' }, { hostHeader: 'localhost:8080' }]);
    });

    test('refuses a host header or server name that is no hostname, certificate settings without https, and any on the MCP', async () => {
        const f = await fixture();

        await readyTunnel(f);

        for (const [origin, code] of [
            [{ hostHeader: 'passly.test/admin' }, 'invalid-host-header'],
            [{ hostHeader: 'passly.test:99999' }, 'invalid-host-header'],
            [{ hostHeader: 'two words' }, 'invalid-host-header'],
            [{ https: true, serverName: 'passly.test:443' }, 'invalid-server-name'],
            [{ noTlsVerify: true }, 'tls-without-https'],
            [{ serverName: 'passly.test' }, 'tls-without-https']
        ] as const) {
            await expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 80, origin })).rejects.toMatchObject({ code });
        }

        await expect(f.service.add({ kind: 'mcp', zone: f.bmnw.id, label: 'mcp-1', origin: { hostHeader: 'passly.test' } })).rejects.toMatchObject({
            code: 'mcp-fixed'
        });
        expect(f.cloudflare.records).toHaveLength(0);
        expect(hostnamesOf(f)).toEqual(['http_status:404']);
    });

    test('changes the port and origin of a row that is on in Cloudflare, and back to the defaults', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();

        const row = (await f.state()).rows[0]!;

        await f.service.update(row.id, { port: 443, origin: { https: true, hostHeader: 'passly.test', noTlsVerify: true } });
        await f.service.idle();

        expect(ourTunnel(f).ingress[0]).toEqual({
            hostname: 'a.bmnw.nl',
            service: 'https://127.0.0.1:443',
            originRequest: { httpHostHeader: 'passly.test', noTLSVerify: true }
        });

        await f.service.update(row.id, { origin: {} });
        await f.service.idle();

        expect(ourTunnel(f).ingress[0]).toEqual({ hostname: 'a.bmnw.nl', service: 'http://127.0.0.1:443' });
        expect((await f.state()).rows[0]).not.toHaveProperty('origin');
        await expect(f.service.update(row.id, { port: API_PORT })).rejects.toMatchObject({ code: 'port-denied' });
        await expect(f.service.update(row.id, { origin: { hostHeader: 'no host' } })).rejects.toMatchObject({ code: 'invalid-host-header' });
    });

    test('sends a new port to Cloudflare when a switch that turns the row on is still on its way', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();

        const row = (await f.state()).rows[0]!;

        await f.service.update(row.id, { enabled: false });
        await f.service.idle();
        await Promise.all([f.service.update(row.id, { enabled: true }), f.service.update(row.id, { port: 4000 })]);
        await f.service.idle();

        expect(ourTunnel(f).ingress[0]).toEqual({ hostname: 'a.bmnw.nl', service: 'http://127.0.0.1:4000' });
    });

    test('keeps the origin of a row that is off without asking Cloudflare, and refuses one on the MCP', async () => {
        const f = await fixture();

        await readyTunnel(f);
        f.listener.on = true;
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.add({ kind: 'mcp', zone: f.bmnw.id, label: 'mcp-1' });
        await f.service.idle();

        const [dev, mcp] = (await f.state()).rows;

        await f.service.update(dev!.id, { enabled: false });
        await f.service.idle();

        const calls = f.cloudflare.calls.length;

        await f.service.update(dev!.id, { origin: { hostHeader: 'passly.test' } });

        expect(f.cloudflare.calls).toHaveLength(calls);
        expect(JSON.parse(await readFile(join(f.home, 'tunnels', 'tunnels.json'), 'utf8')).rows[0].origin).toEqual({ hostHeader: 'passly.test' });
        await expect(f.service.update(mcp!.id, { origin: { hostHeader: 'passly.test' } })).rejects.toMatchObject({ code: 'mcp-fixed' });
        await expect(f.service.update(mcp!.id, { port: 3001 })).rejects.toMatchObject({ code: 'mcp-fixed' });
    });

    test('keeps a key of a row that a newer Ruimte wrote', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();

        const path = join(f.home, 'tunnels', 'tunnels.json');
        const saved = JSON.parse(await readFile(path, 'utf8'));

        saved.rows[0].later = { kept: true };
        await writeFile(path, JSON.stringify(saved));

        const again = await fixture({}, '/usr/bin/cloudflared', { home: f.home, cloudflare: f.cloudflare, tokens: f.tokens });

        await again.service.update(saved.rows[0].id, { comeBack: true });

        expect(JSON.parse(await readFile(path, 'utf8')).rows[0].later).toEqual({ kept: true });
        expect((await again.state()).rows[0]).not.toHaveProperty('later');
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

    test('keeps a row and its record that Cloudflare would not take off the tunnel, and says why', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();
        f.cloudflare.failing.set('PUT /accounts/acc-1/cfd_tunnel', 500);

        await expect(f.service.remove((await f.state()).rows[0]!.id)).rejects.toBeInstanceOf(CloudflareError);

        await f.service.idle();

        const state = await f.state();

        expect(state.stage).toBe('failed');
        expect(state.rows).toMatchObject([{ hostname: 'a.bmnw.nl', enabled: true }]);
        expect(f.cloudflare.records).toHaveLength(1);
        expect(f.runner.running).toBe(1);
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

describe('an existing tunnel', () => {
    const OFFICE_INGRESS = [
        { hostname: 'nas.bmnw.nl', service: 'http://nas:80' },
        { hostname: 'shop.bmnw.nl', path: '/admin', service: 'http://localhost:9000' },
        { service: 'http_status:503' }
    ];

    function office(f: Fixture, change: Parameters<FakeCloudflare['tunnel']>[3] = {}) {
        return f.cloudflare.tunnel('acc-1', 'office', structuredClone(OFFICE_INGRESS), { rest: { 'warp-routing': { enabled: true } }, ...change });
    }

    async function linked(f: Fixture, tunnel: { id: string }): Promise<void> {
        await f.service.setToken(FAKE_API_TOKEN);
        await f.service.link(undefined, tunnel.id);
        await f.service.idle();
    }

    test('lists the tunnels of the account, which Ruimte can use and which run, and uses a picked one without changing it', async () => {
        const f = await fixture();
        const picked = office(f, { connections: 2 });

        f.cloudflare.tunnel('acc-1', 'legacy', [], { configSrc: 'local' });
        await f.service.setToken(FAKE_API_TOKEN);

        expect(await f.service.existing()).toEqual([
            { id: picked.id, name: 'office', usable: true, running: true },
            { id: expect.any(String), name: 'legacy', usable: false, running: false }
        ]);

        await f.service.link(undefined, picked.id);
        await f.service.idle();

        expect(await f.state()).toMatchObject({
            stage: 'running',
            tunnel: {
                name: 'office',
                created: false,
                runner: 'other',
                others: [
                    { hostname: 'nas.bmnw.nl', path: null, service: 'http://nas:80' },
                    { hostname: 'shop.bmnw.nl', path: '/admin', service: 'http://localhost:9000' }
                ]
            },
            rows: []
        });
        expect(f.cloudflare.calls.filter((call) => call.method !== 'GET')).toEqual([]);
        expect(picked.ingress).toEqual(OFFICE_INGRESS);
    });

    test('keeps the tunnel of a first press when a second one asks to use another, and makes or links nothing more', async () => {
        const f = await fixture();
        const picked = office(f);

        await f.service.setToken(FAKE_API_TOKEN);
        await f.service.setup();
        await f.service.link(undefined, picked.id);
        await f.service.setup();
        await f.service.idle();

        expect(await f.state()).toMatchObject({ stage: 'running', message: null, tunnel: { name: 'ruimte-bas-macbook-f7a7', created: true } });
        expect(f.cloudflare.called('POST', '/accounts/')).toHaveLength(1);
        expect(picked.ingress).toEqual(OFFICE_INGRESS);
    });

    test('refuses a tunnel whose settings live in a file on the computer that runs it', async () => {
        const f = await fixture();
        const legacy = f.cloudflare.tunnel('acc-1', 'legacy', [], { configSrc: 'local' });

        await linked(f, legacy);

        const state = await f.state();

        expect(state).toMatchObject({ stage: 'failed', tunnel: null });
        expect(state.message).toContain('legacy is managed in a file');
    });

    test('adds and removes only its own hostname and record, keeping every rule, the catch-all, the settings and the records it found', async () => {
        const f = await fixture();
        const picked = office(f);
        const stranger = f.cloudflare.record(f.bmnw, { name: 'nas.bmnw.nl', type: 'CNAME', content: `${picked.id}.cfargotunnel.com`, proxied: true });

        await linked(f, picked);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();

        expect(picked.ingress).toEqual([...OFFICE_INGRESS.slice(0, 2), { hostname: 'shop.bmnw.nl', service: 'http://127.0.0.1:3000' }, OFFICE_INGRESS[2]]);
        expect(picked.rest).toEqual({ 'warp-routing': { enabled: true } });

        await f.service.remove((await f.state()).rows[0]!.id);
        await f.service.idle();

        expect(picked.ingress).toEqual(OFFICE_INGRESS);
        expect(picked.rest).toEqual({ 'warp-routing': { enabled: true } });
        expect(f.cloudflare.records).toEqual([stranger]);
    });

    test('holds the hostname of a row that is off with a 404 before a catch-all that serves, and the rule follows the switch', async () => {
        const f = await fixture();
        const picked = f.cloudflare.tunnel('acc-1', 'home', [{ service: 'http://localhost:8080' }]);

        await linked(f, picked);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();

        expect(picked.ingress).toEqual([{ hostname: 'shop.bmnw.nl', service: 'http://127.0.0.1:3000' }, { service: 'http://localhost:8080' }]);

        const id = (await f.state()).rows[0]!.id;

        await f.service.update(id, { enabled: false });
        await f.service.idle();

        expect(picked.ingress).toEqual([{ hostname: 'shop.bmnw.nl', service: 'http_status:404' }, { service: 'http://localhost:8080' }]);

        await f.service.update(id, { enabled: true });
        await f.service.idle();

        expect(picked.ingress).toEqual([{ hostname: 'shop.bmnw.nl', service: 'http://127.0.0.1:3000' }, { service: 'http://localhost:8080' }]);
    });

    test('puts the 404 of a row that is off before a rule of the dashboard without a hostname that could catch it', async () => {
        const f = await fixture();
        const picked = f.cloudflare.tunnel('acc-1', 'home', [
            { hostname: 'nas.bmnw.nl', service: 'http://nas:80' },
            { path: '/status', service: 'http://localhost:9000' },
            { service: 'http_status:404' }
        ]);

        await linked(f, picked);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();
        await f.service.update((await f.state()).rows[0]!.id, { enabled: false });
        await f.service.idle();

        expect(picked.ingress).toEqual([
            { hostname: 'nas.bmnw.nl', service: 'http://nas:80' },
            { hostname: 'shop.bmnw.nl', service: 'http_status:404' },
            { path: '/status', service: 'http://localhost:9000' },
            { service: 'http_status:404' }
        ]);
    });

    test('takes the 404 of a removed row off once its record is gone, and leaves what the dashboard set', async () => {
        const f = await fixture();
        const picked = f.cloudflare.tunnel('acc-1', 'home', [{ service: 'http://localhost:8080' }]);

        await linked(f, picked);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();
        await f.service.update((await f.state()).rows[0]!.id, { enabled: false });
        await f.service.idle();
        await f.service.remove((await f.state()).rows[0]!.id);
        await f.service.idle();

        expect(picked.ingress).toEqual([{ service: 'http://localhost:8080' }]);
        expect(f.cloudflare.records).toEqual([]);
        expect((await f.state()).rows).toEqual([]);
    });

    test('takes every 404 of Ruimte off when unlinking', async () => {
        const f = await fixture();
        const picked = f.cloudflare.tunnel('acc-1', 'home', [{ service: 'http://localhost:8080' }]);

        await linked(f, picked);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();
        await f.service.update((await f.state()).rows[0]!.id, { enabled: false });
        await f.service.idle();
        await f.service.unlink();

        expect(picked.ingress).toEqual([{ service: 'http://localhost:8080' }]);
        expect(f.cloudflare.records).toEqual([]);
    });

    test('still knows its 404s when unlinking again after Cloudflare refused to take them off, so the hostname can come back', async () => {
        const f = await fixture();
        const picked = f.cloudflare.tunnel('acc-1', 'home', [{ service: 'http://localhost:8080' }]);

        await linked(f, picked);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();
        await f.service.update((await f.state()).rows[0]!.id, { enabled: false });
        await f.service.idle();
        f.cloudflare.failing.set('PUT /accounts/acc-1/cfd_tunnel', 400);

        await expect(f.service.unlink()).rejects.toBeInstanceOf(CloudflareError);

        f.cloudflare.failing.clear();
        await f.service.unlink();

        expect(picked.ingress).toEqual([{ service: 'http://localhost:8080' }]);
        expect(f.cloudflare.records).toEqual([]);

        await linked(f, picked);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();

        expect(picked.ingress).toEqual([{ hostname: 'shop.bmnw.nl', service: 'http://127.0.0.1:3000' }, { service: 'http://localhost:8080' }]);
    });

    test('leaves the hostname of a refused add on a 404, so the catch-all never serves it', async () => {
        let writes = 0;
        const cloudflare = new FakeCloudflare();
        const f = await fixture(
            {
                // Cloudflare takes the 404 and refuses the rule that would serve the row.
                cloudflare: async (url, init) => {
                    if (init.method === 'PUT' && url.endsWith('/configurations') && (writes += 1) === 2) {
                        return Response.json(
                            { success: false, errors: [{ code: 1000, message: 'Fake failure' }], messages: [], result: null },
                            { status: 400 }
                        );
                    }

                    return cloudflare.fetch(url, init);
                }
            },
            '/usr/bin/cloudflared',
            { cloudflare }
        );
        const picked = cloudflare.tunnel('acc-1', 'home', [{ service: 'http://localhost:8080' }]);

        await linked(f, picked);

        expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 })).rejects.toBeInstanceOf(CloudflareError);

        await f.service.idle();

        expect((await f.state()).rows).toMatchObject([{ hostname: 'shop.bmnw.nl', enabled: false }]);
        expect(picked.ingress).toEqual([{ hostname: 'shop.bmnw.nl', service: 'http_status:404' }, { service: 'http://localhost:8080' }]);
    });

    test('makes no record for a new hostname until Cloudflare took its 404, so a catch-all that serves never answers it', async () => {
        const f = await fixture();
        const picked = f.cloudflare.tunnel('acc-1', 'home', [{ service: 'http://localhost:8080' }]);

        await linked(f, picked);
        f.cloudflare.failing.set('PUT /accounts/acc-1/cfd_tunnel', 400);

        await expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 })).rejects.toBeInstanceOf(CloudflareError);

        await f.service.idle();

        expect(f.cloudflare.records).toEqual([]);
        expect(picked.ingress).toEqual([{ service: 'http://localhost:8080' }]);
        expect((await f.state()).rows).toEqual([]);
    });

    test('keeps a hostname whose record Cloudflare refused after its 404, and Remove takes the 404 off', async () => {
        const f = await fixture();
        const picked = f.cloudflare.tunnel('acc-1', 'home', [{ service: 'http://localhost:8080' }]);

        await linked(f, picked);
        f.cloudflare.failing.set('POST /zones/zone-bmnw.nl/dns_records', 400);

        await expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 })).rejects.toBeInstanceOf(CloudflareError);

        await f.service.idle();
        f.cloudflare.failing.clear();

        expect(f.cloudflare.records).toEqual([]);
        expect(picked.ingress).toEqual([{ hostname: 'shop.bmnw.nl', service: 'http_status:404' }, { service: 'http://localhost:8080' }]);
        expect((await f.state()).rows).toMatchObject([{ hostname: 'shop.bmnw.nl', enabled: false }]);

        await f.service.remove((await f.state()).rows[0]!.id);
        await f.service.idle();

        expect(picked.ingress).toEqual([{ service: 'http://localhost:8080' }]);
        expect(f.cloudflare.records).toEqual([]);
        expect((await f.state()).rows).toEqual([]);
    });

    test('tells the clients about a hostname kept after Cloudflare refused its record, so they can remove it', async () => {
        const f = await fixture();
        const picked = f.cloudflare.tunnel('acc-1', 'home', [{ service: 'http://localhost:8080' }]);

        await linked(f, picked);
        f.cloudflare.failing.set('POST /zones/zone-bmnw.nl/dns_records', 403);

        const before = f.events.count;

        await expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 })).rejects.toBeInstanceOf(CloudflareError);

        expect(f.events.count).toBeGreaterThan(before);
        expect((await f.state()).rows).toMatchObject([{ hostname: 'shop.bmnw.nl', enabled: false }]);
    });

    test('tells the clients about a hostname switched off when Cloudflare refused to delete its record', async () => {
        const f = await fixture();
        const picked = f.cloudflare.tunnel('acc-1', 'home', [{ service: 'http://localhost:8080' }]);

        await linked(f, picked);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();
        f.cloudflare.failing.set('DELETE /zones/zone-bmnw.nl/dns_records', 403);

        const before = f.events.count;

        await expect(f.service.remove((await f.state()).rows[0]!.id)).rejects.toBeInstanceOf(CloudflareError);

        expect(f.events.count).toBeGreaterThan(before);
        expect((await f.state()).rows).toMatchObject([{ hostname: 'shop.bmnw.nl', enabled: false }]);
    });

    test('keeps a new hostname whose 404 Cloudflare may have taken without the answer arriving, and Remove takes it off', async () => {
        const cloudflare = new FakeCloudflare();
        const lost = { value: false };
        const f = await fixture(
            {
                cloudflare: async (url, init) => {
                    const answer = await cloudflare.fetch(url, init);

                    if (lost.value && init.method === 'PUT' && url.endsWith('/configurations')) {
                        lost.value = false;

                        throw new Error('offline');
                    }

                    return answer;
                }
            },
            '/usr/bin/cloudflared',
            { cloudflare }
        );
        const picked = cloudflare.tunnel('acc-1', 'home', [{ service: 'http://localhost:8080' }]);

        await linked(f, picked);
        lost.value = true;

        await expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 })).rejects.toMatchObject({ code: 'unreachable' });

        await f.service.idle();

        expect(cloudflare.records).toEqual([]);
        expect(picked.ingress).toEqual([{ hostname: 'shop.bmnw.nl', service: 'http_status:404' }, { service: 'http://localhost:8080' }]);
        expect((await f.state()).rows).toMatchObject([{ hostname: 'shop.bmnw.nl', enabled: false }]);

        await f.service.remove((await f.state()).rows[0]!.id);
        await f.service.idle();

        expect(picked.ingress).toEqual([{ service: 'http://localhost:8080' }]);
        expect((await f.state()).rows).toEqual([]);
    });

    test('drops a new hostname whose 404 Cloudflare turned down, and tells the clients', async () => {
        const f = await fixture();
        const picked = f.cloudflare.tunnel('acc-1', 'home', [{ service: 'http://localhost:8080' }]);

        await linked(f, picked);
        f.cloudflare.failing.set('PUT /accounts/acc-1/cfd_tunnel', 403);

        const before = f.events.count;

        await expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 })).rejects.toMatchObject({ code: 'no-permission' });

        expect(f.events.count).toBeGreaterThan(before);
        expect(picked.ingress).toEqual([{ service: 'http://localhost:8080' }]);
        expect((await f.state()).rows).toEqual([]);
        expect(tunnelStore(f.home).read()?.rows).toEqual([]);
    });

    test('makes the missing record of a hostname before it turns it on, and keeps it off while Cloudflare refuses the record', async () => {
        const f = await fixture();
        const picked = f.cloudflare.tunnel('acc-1', 'home', [{ service: 'http://localhost:8080' }]);

        await linked(f, picked);
        f.cloudflare.failing.set('POST /zones/zone-bmnw.nl/dns_records', 403);

        await expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 })).rejects.toBeInstanceOf(CloudflareError);

        const row = (await f.state()).rows[0]!;

        await expect(f.service.update(row.id, { enabled: true })).rejects.toMatchObject({ code: 'no-permission' });

        await f.service.idle();

        expect(f.cloudflare.records).toEqual([]);
        expect(picked.ingress).toEqual([{ hostname: 'shop.bmnw.nl', service: 'http_status:404' }, { service: 'http://localhost:8080' }]);
        expect(await f.state()).toMatchObject({ stage: 'failed', rows: [{ hostname: 'shop.bmnw.nl', enabled: false }] });
        expect(f.runner.running).toBe(0);

        // The person gave the token DNS edit.
        f.cloudflare.failing.clear();
        await f.service.update(row.id, { enabled: true });
        await f.service.idle();

        expect(f.cloudflare.records.map((record) => [record.name, record.content, record.comment])).toEqual([
            ['shop.bmnw.nl', `${picked.id}.cfargotunnel.com`, MARKER]
        ]);
        expect(picked.ingress).toEqual([{ hostname: 'shop.bmnw.nl', service: 'http://127.0.0.1:3000' }, { service: 'http://localhost:8080' }]);
        expect(await f.state()).toMatchObject({ stage: 'running', rows: [{ hostname: 'shop.bmnw.nl', enabled: true }] });
        expect(f.runner.running).toBe(1);
    });

    test('makes the missing record of a hostname that comes back on after a restart, and keeps it off while Cloudflare refuses the record', async () => {
        const f = await fixture();
        const picked = f.cloudflare.tunnel('acc-1', 'home', [{ service: 'http://localhost:8080' }]);

        await linked(f, picked);
        f.cloudflare.failing.set('POST /zones/zone-bmnw.nl/dns_records', 403);

        await expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000, comeBack: true })).rejects.toBeInstanceOf(CloudflareError);

        await f.service.stop();

        // An older Ruimte turned the row on without its record.
        const stored = tunnelStore(f.home).read()!;

        tunnelStore(f.home).write({ ...stored, rows: stored.rows.map((row) => ({ ...row, enabled: true })) });

        const refused = await fixture({}, '/usr/bin/cloudflared', { home: f.home, cloudflare: f.cloudflare, tokens: f.tokens });

        await refused.service.resume();
        await refused.service.idle();

        expect(f.cloudflare.records).toEqual([]);
        expect(picked.ingress).toEqual([{ hostname: 'shop.bmnw.nl', service: 'http_status:404' }, { service: 'http://localhost:8080' }]);
        expect(await refused.state()).toMatchObject({ stage: 'failed', rows: [{ hostname: 'shop.bmnw.nl', enabled: false }] });
        expect(refused.runner.running).toBe(0);

        await refused.service.stop();
        tunnelStore(f.home).write({ ...stored, rows: stored.rows.map((row) => ({ ...row, enabled: true })) });
        f.cloudflare.failing.clear();

        const again = await fixture({}, '/usr/bin/cloudflared', { home: f.home, cloudflare: f.cloudflare, tokens: f.tokens });

        await again.service.resume();
        await again.service.idle();

        expect(f.cloudflare.records.map((record) => [record.name, record.comment])).toEqual([['shop.bmnw.nl', MARKER]]);
        expect(picked.ingress).toEqual([{ hostname: 'shop.bmnw.nl', service: 'http://127.0.0.1:3000' }, { service: 'http://localhost:8080' }]);
        expect(await again.state()).toMatchObject({ stage: 'running', rows: [{ hostname: 'shop.bmnw.nl', enabled: true }] });
        expect(again.runner.running).toBe(1);
    });

    test('writes the origin settings into its own rule only, and lists the host header of a rule of the dashboard', async () => {
        const f = await fixture();
        const picked = f.cloudflare.tunnel(
            'acc-1',
            'office',
            [
                { hostname: 'nas.bmnw.nl', service: 'http://nas:80', originRequest: { httpHostHeader: 'nas.local', noTLSVerify: true } },
                { service: 'http_status:503' }
            ],
            { rest: { originRequest: { connectTimeout: '10s' } } }
        );

        await linked(f, picked);
        await f.service.add({
            kind: 'dev',
            zone: f.bmnw.id,
            label: 'passly',
            port: 443,
            origin: { https: true, hostHeader: 'passly.test', noTlsVerify: true, serverName: 'passly.test' }
        });
        await f.service.idle();

        expect(picked.ingress).toEqual([
            { hostname: 'nas.bmnw.nl', service: 'http://nas:80', originRequest: { httpHostHeader: 'nas.local', noTLSVerify: true } },
            {
                hostname: 'passly.bmnw.nl',
                service: 'https://127.0.0.1:443',
                originRequest: { httpHostHeader: 'passly.test', noTLSVerify: true, originServerName: 'passly.test' }
            },
            { service: 'http_status:503' }
        ]);
        expect(picked.rest).toEqual({ originRequest: { connectTimeout: '10s' } });

        const state = await f.state();

        expect(state.rows[0]?.origin).toEqual({ https: true, hostHeader: 'passly.test', noTlsVerify: true, serverName: 'passly.test' });
        expect(state.tunnel?.others).toEqual([{ hostname: 'nas.bmnw.nl', path: null, service: 'http://nas:80', hostHeader: 'nas.local' }]);
    });

    test('puts its rule before a wildcard of the dashboard that would catch its hostname, keeping the order of the rest', async () => {
        const f = await fixture();
        const picked = f.cloudflare.tunnel('acc-1', 'office', [
            { hostname: 'shop.bmnw.nl', path: '/admin', service: 'http://localhost:9000' },
            { hostname: 'nas.passly.dev', service: 'http://nas:80' },
            { hostname: '*.bmnw.nl', service: 'http://proxy:80' },
            { service: 'http_status:503' }
        ]);

        await linked(f, picked);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();

        expect(picked.ingress).toEqual([
            { hostname: 'shop.bmnw.nl', path: '/admin', service: 'http://localhost:9000' },
            { hostname: 'nas.passly.dev', service: 'http://nas:80' },
            { hostname: 'shop.bmnw.nl', service: 'http://127.0.0.1:3000' },
            { hostname: '*.bmnw.nl', service: 'http://proxy:80' },
            { service: 'http_status:503' }
        ]);
    });

    test('recognizes a catch-all that Cloudflare sends with an empty path and hostname, and adds no second one', async () => {
        const f = await fixture();

        await readyTunnel(f);
        ourTunnel(f).ingress = [{ hostname: '', path: '', service: 'http_status:404', originRequest: {} }];
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();

        expect(ourTunnel(f).ingress).toEqual([{ hostname: 'a.bmnw.nl', service: 'http://127.0.0.1:3000' }, { service: 'http_status:404' }]);
    });

    test('writes nothing when Cloudflare sends its rules back with empty fields and keys in another order', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });
        await f.service.idle();
        ourTunnel(f).ingress = [
            { service: 'http://127.0.0.1:3000', path: null, originRequest: {}, hostname: 'a.bmnw.nl' },
            { service: 'http_status:404', hostname: null, path: '' }
        ];

        const writes = f.cloudflare.called('PUT', '/accounts/acc-1/cfd_tunnel').length;

        await f.service.retry();
        await f.service.idle();

        expect(f.cloudflare.called('PUT', '/accounts/acc-1/cfd_tunnel')).toHaveLength(writes);
        expect((await f.state()).tunnel?.others).toEqual([]);
    });

    test('writes nothing to a picked tunnel without a catch-all while it has no hostname of Ruimte', async () => {
        const f = await fixture();
        const picked = f.cloudflare.tunnel('acc-1', 'bare', [{ hostname: 'nas.bmnw.nl', service: 'http://nas:80' }]);

        await linked(f, picked);
        await f.service.retry();
        await f.service.idle();

        expect(f.cloudflare.called('PUT', '/accounts/')).toEqual([]);
        expect(picked.ingress).toEqual([{ hostname: 'nas.bmnw.nl', service: 'http://nas:80' }]);
    });

    test('refuses a hostname the dashboard already routes on the tunnel, and writes nothing', async () => {
        const f = await fixture();
        const picked = office(f);

        await linked(f, picked);

        const before = f.cloudflare.calls.length;

        expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'nas', port: 3000 })).rejects.toMatchObject({ code: 'hostname-on-tunnel' });

        await f.service.idle();

        expect(f.cloudflare.calls.slice(before).filter((call) => call.method !== 'GET')).toEqual([]);
        expect(picked.ingress).toEqual(OFFICE_INGRESS);
    });

    test('starts no cloudflared while something else runs the tunnel, and runs its own once that stopped and Try again looked', async () => {
        const f = await fixture();
        const picked = office(f, { connections: 1 });

        await linked(f, picked);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();

        expect(f.runner.calls).toEqual([]);
        expect(f.cloudflare.called('GET', `/accounts/acc-1/cfd_tunnel/${picked.id}/token`)).toEqual([]);
        expect((await f.state()).tunnel).toMatchObject({ runner: 'other' });

        picked.connections = 0;
        await f.service.retry();
        await f.service.idle();

        expect(f.runner.running).toBe(1);
        expect((await f.state()).tunnel).toMatchObject({ runner: 'ruimte' });
    });

    test('unlinks by taking off only what Ruimte added, and never deletes the tunnel at Cloudflare', async () => {
        const f = await fixture();
        const picked = office(f);

        await linked(f, picked);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();

        expect(f.runner.running).toBe(1);

        await f.service.unlink();

        expect(await f.state()).toMatchObject({ stage: 'no-tunnel', tunnel: null, rows: [] });
        expect(f.cloudflare.tunnels).toContain(picked);
        expect(picked.ingress).toEqual(OFFICE_INGRESS);
        expect(f.cloudflare.records).toEqual([]);
        expect(f.cloudflare.called('DELETE', '/accounts/')).toEqual([]);
        expect(f.runner.running).toBe(0);
    });

    test('forgets a tunnel the token may not read when unlinking, and says its hostnames and records stay', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();
        f.cloudflare.failing.set('GET /accounts/acc-1/cfd_tunnel', 403);
        await f.service.unlink();

        const state = await f.state();

        expect(state).toMatchObject({ stage: 'failed', tunnel: null, rows: [] });
        expect(state.message).toBe('Ruimte forgot ruimte-bas-macbook-f7a7, but its hostnames and DNS records stay in Cloudflare.');
        expect(f.cloudflare.records).toHaveLength(1);
        expect(hostnamesOf(f)).toEqual(['shop.bmnw.nl', 'http_status:404']);
        expect(f.runner.running).toBe(0);
    });

    test('forgets a tunnel when unlinking with a token Cloudflare no longer takes, and says its hostnames and records stay', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();
        f.cloudflare.acceptedToken = 'cf-api-token-of-another-day';
        await f.service.unlink();

        const state = await f.state();

        expect(state).toMatchObject({ stage: 'failed', tunnel: null, rows: [] });
        expect(state.message).toBe('Ruimte forgot ruimte-bas-macbook-f7a7, but its hostnames and DNS records stay in Cloudflare.');
        expect(f.cloudflare.records).toHaveLength(1);
        expect(f.runner.running).toBe(0);
    });

    test('forgets a tunnel when unlinking after the token was removed, without asking Cloudflare', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();
        await f.service.clearToken();

        const calls = f.cloudflare.calls.length;

        await f.service.unlink();

        const state = await f.state();

        expect(state).toMatchObject({ tunnel: null, rows: [] });
        expect(state.message).toBe('Ruimte forgot ruimte-bas-macbook-f7a7, but its hostnames and DNS records stay in Cloudflare.');
        expect(f.cloudflare.calls).toHaveLength(calls);
        expect(f.cloudflare.records).toHaveLength(1);
    });

    test('forgets a tunnel on an account the token does not reach when unlinking, without asking that account', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();
        f.cloudflare.zones.splice(0);
        f.cloudflare.zone('work.dev', { id: 'acc-2', name: 'Work' });
        await f.service.setToken(FAKE_API_TOKEN);
        await f.service.idle();
        f.cloudflare.failing.set('GET /accounts/acc-1/cfd_tunnel', 404);
        f.cloudflare.failing.set('GET /zones/zone-bmnw.nl', 403);
        await f.service.unlink();

        expect(await f.state()).toMatchObject({ tunnel: null, rows: [] });
        expect(f.cloudflare.records).toHaveLength(1);
    });

    test('unlinks a tunnel it made the same way, leaving it in Cloudflare for this machine to pick again', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'shop', port: 3000 });
        await f.service.idle();
        await f.service.unlink();

        expect(f.cloudflare.tunnels.map((tunnel) => tunnel.name)).toEqual(['ruimte-bas-macbook-f7a7']);
        expect(hostnamesOf(f)).toEqual(['http_status:404']);
        expect(f.cloudflare.called('DELETE', '/accounts/')).toEqual([]);
        expect(await f.service.existing()).toMatchObject([{ name: 'ruimte-bas-macbook-f7a7', usable: true }]);
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
        expect(hostnamesOf(again)).toEqual(['one.bmnw.nl', 'three.bmnw.nl', 'two.bmnw.nl', 'http_status:404']);
        expect(ourTunnel(again).ingress[2]).toEqual({ hostname: 'two.bmnw.nl', service: 'http_status:404' });
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

    test('brings the tunnel up once the network is back after a boot without it', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000, comeBack: true });
        await f.service.idle();
        await f.service.stop();

        const offline = { value: true };
        const again = await fixture(
            { cloudflare: (url, init) => (offline.value ? Promise.reject(new Error('offline')) : f.cloudflare.fetch(url, init)) },
            '/usr/bin/cloudflared',
            { home: f.home, tokens: f.tokens, cloudflare: f.cloudflare }
        );

        await again.service.resume();
        await again.service.idle();
        offline.value = false;
        again.service.networkBack();
        await again.service.idle();

        expect(await again.state()).toMatchObject({ stage: 'running', message: null });
        expect(again.runner.running).toBe(1);
    });

    test('tries once more when the network came back while a bring-up was still waiting on Cloudflare', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000, comeBack: true });
        await f.service.idle();
        await f.service.stop();

        let fail: () => void = () => undefined;
        const offline = { value: true };
        const stalled = new Promise<void>((resolve) => {
            fail = resolve;
        });
        const again = await fixture(
            {
                cloudflare: (url, init) => (offline.value ? stalled.then(() => Promise.reject(new Error('offline'))) : f.cloudflare.fetch(url, init))
            },
            '/usr/bin/cloudflared',
            { home: f.home, tokens: f.tokens, cloudflare: f.cloudflare }
        );

        await again.service.resume();
        again.service.networkBack();
        offline.value = false;
        fail();
        await again.service.idle();

        expect(await again.state()).toMatchObject({ stage: 'running', message: null });
        expect(again.runner.running).toBe(1);
    });

    test('shows a job queued behind one that fails as busy until it ends, not the failure before it', async () => {
        const cloudflare = new FakeCloudflare();
        const held: Array<(fail: boolean) => void> = [];
        const hold = { value: false };
        let arrived: () => void = () => undefined;
        const f = await fixture(
            {
                cloudflare: (url, init) => {
                    if (!hold.value) {
                        return cloudflare.fetch(url, init);
                    }

                    return new Promise((resolve, reject) => {
                        held.push((fail) => (fail ? reject(new Error('offline')) : resolve(cloudflare.fetch(url, init))));
                        arrived();
                    });
                }
            },
            '/usr/bin/cloudflared',
            { cloudflare }
        );

        const heldCount = (count: number): Promise<void> =>
            new Promise((resolve) => {
                const check = (): void => {
                    if (held.length >= count) {
                        resolve();
                    } else {
                        arrived = check;
                    }
                };

                check();
            });

        await readyTunnel(f);
        hold.value = true;
        await f.service.retry();
        await f.service.retry();
        await heldCount(1);
        held[0]!(true);
        await heldCount(2);

        expect(await f.state()).toMatchObject({ stage: 'checking', message: null });

        hold.value = false;
        held[1]!(false);
        await f.service.idle();

        expect(await f.state()).toMatchObject({ stage: 'running', message: null });
    });

    test('tries nothing again when the network comes back after a failure that was not about the network', async () => {
        const f = await fixture();

        await readyTunnel(f);
        f.cloudflare.failing.set('GET /accounts/acc-1/cfd_tunnel', 403);
        await f.service.retry();
        await f.service.idle();

        const calls = f.cloudflare.calls.length;

        f.service.networkBack();
        await f.service.idle();

        expect(f.cloudflare.calls).toHaveLength(calls);
        expect((await f.state()).stage).toBe('failed');
    });

    test('starts no cloudflared after it stopped, also when Cloudflare answers the run token later', async () => {
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const cloudflare = new FakeCloudflare();
        const f = await fixture(
            {
                cloudflare: async (url, init) => {
                    if (url.endsWith('/token')) {
                        await held;
                    }

                    return cloudflare.fetch(url, init);
                }
            },
            '/usr/bin/cloudflared',
            { cloudflare }
        );

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000 });

        const stopped = f.service.stop();

        release();
        await stopped;
        await f.service.idle();

        expect(f.runner.calls).toHaveLength(0);
        expect(f.runner.running).toBe(0);
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

describe('what Cloudflare serves after a failure', () => {
    const SAVE = 'PUT /accounts/acc-1/cfd_tunnel';

    async function rowOn(f: Fixture, label: string, port: number, comeBack = false): Promise<string> {
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label, port, comeBack });
        await f.service.idle();

        return (await f.state()).rows.find((row) => row.hostname === `${label}.bmnw.nl`)!.id;
    }

    test('shows a new hostname on whose serving rule landed while the answer did not, and keeps the child of the other hostnames', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await rowOn(f, 'a', 3000);
        // The first write of the add is the 404 that holds the name; the second serves it.
        f.cloudflare.lose(SAVE, 502, 1);

        await expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'b', port: 3001 })).rejects.toBeInstanceOf(CloudflareError);

        await f.service.idle();

        expect(hostnamesOf(f)).toEqual(['a.bmnw.nl', 'b.bmnw.nl', 'http_status:404']);
        expect((await f.state()).rows.map((row) => [row.hostname, row.enabled])).toEqual([
            ['a.bmnw.nl', true],
            ['b.bmnw.nl', true]
        ]);
        expect(
            tunnelStore(f.home)
                .read()
                ?.rows.map((row) => row.enabled)
        ).toEqual([true, false]);
        expect(f.runner.running).toBe(1);
    });

    test('shows a hostname on whose switch landed while the connection dropped', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const id = await rowOn(f, 'a', 3000);

        await f.service.update(id, { enabled: false });
        await f.service.idle();
        f.cloudflare.lose(SAVE, null);

        await expect(f.service.update(id, { enabled: true })).rejects.toMatchObject({ code: 'unreachable' });

        expect(hostnamesOf(f)).toEqual(['a.bmnw.nl', 'http_status:404']);
        expect((await f.state()).rows).toMatchObject([{ hostname: 'a.bmnw.nl', enabled: true }]);
    });

    test('shows the port Cloudflare serves after a port change whose answer got lost', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const id = await rowOn(f, 'a', 3000);

        f.cloudflare.lose(SAVE, 502);

        await expect(f.service.update(id, { port: 3001, origin: { https: true } })).rejects.toBeInstanceOf(CloudflareError);

        expect(ourTunnel(f).ingress[0]).toEqual({ hostname: 'a.bmnw.nl', service: 'https://127.0.0.1:3001' });
        expect((await f.state()).rows).toMatchObject([{ port: 3001, enabled: true, origin: { https: true } }]);
    });

    test('shows a hostname on whose switch may have landed while Cloudflare cannot be read back, and Try again holds it off as it was', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const id = await rowOn(f, 'a', 3000);

        await f.service.update(id, { enabled: false });
        await f.service.idle();
        f.cloudflare.lose(SAVE, 502);
        f.cloudflare.writers.push(() => f.cloudflare.failing.set('GET /accounts/acc-1/cfd_tunnel', 503));

        await expect(f.service.update(id, { enabled: true })).rejects.toBeInstanceOf(CloudflareError);

        expect(await f.state()).toMatchObject({ stage: 'failed', rows: [{ enabled: true }] });

        f.cloudflare.failing.clear();
        await f.service.retry();
        await f.service.idle();

        expect(await f.state()).toMatchObject({ stage: 'running', message: null, rows: [{ enabled: false }] });
        expect(ourTunnel(f).ingress).toEqual([{ hostname: 'a.bmnw.nl', service: 'http_status:404' }, { service: 'http_status:404' }]);
        expect(f.runner.running).toBe(0);
    });

    test('shows a hostname that does not come back after a restart on until Cloudflare took it off', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await rowOn(f, 'a', 3000);
        await f.service.stop();

        const again = await fixture({}, '/usr/bin/cloudflared', { home: f.home, cloudflare: f.cloudflare, tokens: f.tokens });

        f.cloudflare.failing.set(SAVE, 403);
        await again.service.resume();
        await again.service.idle();

        expect(hostnamesOf(again)).toEqual(['a.bmnw.nl', 'http_status:404']);
        expect(await again.state()).toMatchObject({ stage: 'failed', rows: [{ hostname: 'a.bmnw.nl', enabled: true }] });
        expect(tunnelStore(f.home).read()?.rows).toMatchObject([{ enabled: false }]);

        f.cloudflare.failing.clear();
        await again.service.retry();
        await again.service.idle();

        expect(ourTunnel(again).ingress).toEqual([{ hostname: 'a.bmnw.nl', service: 'http_status:404' }, { service: 'http_status:404' }]);
        expect(await again.state()).toMatchObject({ stage: 'running', rows: [{ hostname: 'a.bmnw.nl', enabled: false }] });
        expect(tunnelStore(f.home).read()?.rows).toMatchObject([{ enabled: false }]);
        expect(again.runner.running).toBe(0);
    });

    test('takes its rule off again when another writer put it back right after Ruimte took it off', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const id = await rowOn(f, 'a', 3000);
        const stale = [...ourTunnel(f).ingress];

        f.cloudflare.writers.push((tunnel) => {
            tunnel.ingress = stale;
        });
        await f.service.update(id, { enabled: false });
        await f.service.idle();

        expect(ourTunnel(f).ingress).toEqual([{ hostname: 'a.bmnw.nl', service: 'http_status:404' }, { service: 'http_status:404' }]);
        expect((await f.state()).rows).toMatchObject([{ enabled: false }]);
        expect(f.runner.running).toBe(0);
    });

    test('shows what Cloudflare serves when another writer keeps putting its rule back', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const id = await rowOn(f, 'a', 3000);
        const stale = [...ourTunnel(f).ingress];
        const putBack = (tunnel: { ingress: Array<Record<string, unknown>> }): void => {
            tunnel.ingress = stale;
        };

        f.cloudflare.writers.push(putBack, putBack);
        await f.service.update(id, { enabled: false });
        await f.service.idle();

        expect(hostnamesOf(f)).toEqual(['a.bmnw.nl', 'http_status:404']);
        expect((await f.state()).rows).toMatchObject([{ enabled: true }]);
        expect(f.runner.running).toBe(1);
    });

    test('holds a hostname that is off with a 404 of its own, so a catch-all another writer makes serve never answers it', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const id = await rowOn(f, 'a', 3000);

        f.cloudflare.writers.push((tunnel) => {
            tunnel.ingress = tunnel.ingress.map((rule) => (rule.hostname === undefined ? { service: 'http://localhost:9999' } : rule));
        });
        await f.service.update(id, { enabled: false });
        await f.service.idle();

        expect(ourTunnel(f).ingress).toEqual([{ hostname: 'a.bmnw.nl', service: 'http_status:404' }, { service: 'http://localhost:9999' }]);
        expect((await f.state()).rows).toMatchObject([{ enabled: false }]);
    });

    test('shows a hostname on whose 404 another writer keeps taking away, since a catch-all may serve it', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const id = await rowOn(f, 'a', 3000);
        const serving = (tunnel: { ingress: Array<Record<string, unknown>> }): void => {
            tunnel.ingress = [{ service: 'http://localhost:9999' }];
        };

        f.cloudflare.writers.push(serving, serving);
        await f.service.update(id, { enabled: false });
        await f.service.idle();

        expect((await f.state()).rows).toMatchObject([{ enabled: true }]);
    });

    test('makes the record again when a hostname turns on after Remove deleted its record and its last write failed', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const id = await rowOn(f, 'a', 3000);

        f.cloudflare.writers.push(() => f.cloudflare.failing.set(SAVE, 500));

        await expect(f.service.remove(id)).rejects.toBeInstanceOf(CloudflareError);

        expect(f.cloudflare.records).toHaveLength(0);
        expect((await f.state()).rows).toMatchObject([{ hostname: 'a.bmnw.nl', enabled: false }]);

        f.cloudflare.failing.clear();
        await f.service.update(id, { enabled: true });
        await f.service.idle();

        expect(f.cloudflare.records).toMatchObject([{ name: 'a.bmnw.nl', comment: MARKER }]);
        expect((await f.state()).rows).toMatchObject([{ hostname: 'a.bmnw.nl', enabled: true }]);
    });

    test('keeps the tunnel and its rows when unlinking while another writer keeps putting a rule of Ruimte back', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await rowOn(f, 'a', 3000);

        const stale = [...ourTunnel(f).ingress];
        const putBack = (tunnel: { ingress: Array<Record<string, unknown>> }): void => {
            tunnel.ingress = stale;
        };

        f.cloudflare.writers.push(() => undefined, putBack, putBack);

        await expect(f.service.unlink()).rejects.toMatchObject({ code: 'unlink-incomplete' });

        const state = await f.state();

        expect(state.tunnel).toMatchObject({ name: 'ruimte-bas-macbook-f7a7' });
        expect(state.rows).toMatchObject([{ hostname: 'a.bmnw.nl', enabled: true }]);
        expect(state.message).toContain('a.bmnw.nl');
        expect(tunnelStore(f.home).read()?.tunnel).not.toBeNull();
    });

    test('keeps a new hostname whose first 404 landed when Cloudflare turned down the write after it', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await rowOn(f, 'a', 3000);
        f.cloudflare.writers.push((tunnel) => {
            tunnel.ingress = tunnel.ingress.map((rule) => (rule.hostname === 'a.bmnw.nl' ? { ...rule, service: 'http://127.0.0.1:3005' } : rule));
            f.cloudflare.failing.set(SAVE, 403);
        });

        await expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'b', port: 3001 })).rejects.toMatchObject({ code: 'no-permission' });

        expect(ourTunnel(f).ingress).toContainEqual({ hostname: 'b.bmnw.nl', service: 'http_status:404' });
        expect((await f.state()).rows).toMatchObject([
            { hostname: 'a.bmnw.nl', enabled: true, port: 3005 },
            { hostname: 'b.bmnw.nl', enabled: false }
        ]);
    });
});

describe('what the person asked and what Cloudflare serves', () => {
    const SAVE = 'PUT /accounts/acc-1/cfd_tunnel';
    const READ = 'GET /accounts/acc-1/cfd_tunnel';

    async function rowOn(f: Fixture, label: string, port: number): Promise<string> {
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label, port });
        await f.service.idle();

        return (await f.state()).rows.find((row) => row.hostname === `${label}.bmnw.nl`)!.id;
    }

    function prependWildcard(tunnel: { ingress: Array<Record<string, unknown>> }): void {
        tunnel.ingress = [{ hostname: '*.bmnw.nl', service: 'http://localhost:9999' }, ...tunnel.ingress];
    }

    test('finishes a Remove on Try again after its last answer got lost and the read back failed, and publishes nothing', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const id = await rowOn(f, 'a', 3000);

        // The first write holds the name with a 404; the answer of the one that takes the 404 off gets lost, and so does the read back.
        f.cloudflare.lose(SAVE, 502, 1);
        f.cloudflare.writers.push(
            () => undefined,
            () => f.cloudflare.failing.set(READ, 503)
        );

        await expect(f.service.remove(id)).rejects.toBeInstanceOf(CloudflareError);

        f.cloudflare.failing.clear();
        await f.service.retry();
        await f.service.idle();

        expect(ourTunnel(f).ingress).toEqual([{ service: 'http_status:404' }]);
        expect(f.cloudflare.records).toEqual([]);
        expect((await f.state()).rows).toEqual([]);
        expect(f.runner.running).toBe(0);
    });

    test('finishes an unlink on Try again after another writer put a rule back, without a record or a child', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await rowOn(f, 'a', 3000);

        const stale = [...ourTunnel(f).ingress];
        const putBack = (tunnel: { ingress: Array<Record<string, unknown>> }): void => {
            tunnel.ingress = stale;
        };

        f.cloudflare.writers.push(() => undefined, putBack, putBack);

        await expect(f.service.unlink()).rejects.toMatchObject({ code: 'unlink-incomplete' });

        expect((await f.state()).message).toContain('Try again to take them off and finish');

        await f.service.retry();
        await f.service.idle();

        expect(ourTunnel(f).ingress).toEqual([{ service: 'http_status:404' }]);
        expect(f.cloudflare.records).toEqual([]);
        expect(f.runner.running).toBe(0);
        expect(await f.state()).toMatchObject({ tunnel: null, rows: [] });
        expect(tunnelStore(f.home).read()?.tunnel).toBeNull();
    });

    test('keeps a hostname off that Cloudflare serves after another writer took its 404, and puts the 404 back on the next write', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const a = await rowOn(f, 'a', 3000);
        const b = await rowOn(f, 'b', 3001);

        await f.service.update(b, { enabled: false });
        await f.service.idle();
        ourTunnel(f).ingress = [{ hostname: 'a.bmnw.nl', service: 'http://127.0.0.1:3000' }, { service: 'http://localhost:9999' }];
        f.cloudflare.failing.set(SAVE, 500);

        await expect(f.service.update(a, { port: 3002 })).rejects.toBeInstanceOf(CloudflareError);

        expect((await f.state()).rows).toMatchObject([
            { hostname: 'a.bmnw.nl', enabled: true, port: 3000 },
            { hostname: 'b.bmnw.nl', enabled: true }
        ]);
        expect(
            tunnelStore(f.home)
                .read()
                ?.rows.map((row) => [row.hostname, row.enabled, row.port])
        ).toEqual([
            ['a.bmnw.nl', true, 3000],
            ['b.bmnw.nl', false, 3001]
        ]);

        f.cloudflare.failing.clear();
        await f.service.retry();
        await f.service.idle();

        expect(ourTunnel(f).ingress).toEqual([
            { hostname: 'a.bmnw.nl', service: 'http://127.0.0.1:3000' },
            { hostname: 'b.bmnw.nl', service: 'http_status:404' },
            { service: 'http://localhost:9999' }
        ]);
        expect((await f.state()).rows).toMatchObject([
            { hostname: 'a.bmnw.nl', enabled: true },
            { hostname: 'b.bmnw.nl', enabled: false }
        ]);
    });

    test('never publishes a new hostname whose first 404 Cloudflare failed with a 503, also not on Try again', async () => {
        const f = await fixture();

        await readyTunnel(f);
        f.cloudflare.failing.set(SAVE, 503);

        await expect(f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000, comeBack: true })).rejects.toBeInstanceOf(CloudflareError);

        f.cloudflare.failing.clear();
        await f.service.retry();
        await f.service.idle();

        expect(ourTunnel(f).ingress).toEqual([{ hostname: 'a.bmnw.nl', service: 'http_status:404' }, { service: 'http_status:404' }]);
        expect(f.cloudflare.records).toEqual([]);
        expect((await f.state()).rows).toMatchObject([{ hostname: 'a.bmnw.nl', enabled: false }]);
        expect(f.runner.running).toBe(0);
    });

    test('puts its 404 back before a wildcard another writer put in front of it', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const a = await rowOn(f, 'a', 3000);
        const b = await rowOn(f, 'b', 3001);

        await f.service.update(a, { enabled: false });
        await f.service.idle();
        f.cloudflare.writers.push(prependWildcard);
        await f.service.update(b, { port: 3005 });
        await f.service.idle();

        expect(ourTunnel(f).ingress).toEqual([
            { hostname: 'b.bmnw.nl', service: 'http://127.0.0.1:3005' },
            { hostname: 'a.bmnw.nl', service: 'http_status:404' },
            { hostname: '*.bmnw.nl', service: 'http://localhost:9999' },
            { service: 'http_status:404' }
        ]);
        expect((await f.state()).rows).toMatchObject([{ hostname: 'a.bmnw.nl', enabled: false }, { enabled: true }]);
    });

    test('shows a hostname on while another writer keeps putting a wildcard before its 404', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const a = await rowOn(f, 'a', 3000);
        const b = await rowOn(f, 'b', 3001);

        await f.service.update(a, { enabled: false });
        await f.service.idle();
        f.cloudflare.writers.push(prependWildcard, prependWildcard);
        await f.service.update(b, { port: 3005 });
        await f.service.idle();

        expect(ourTunnel(f).ingress[0]).toEqual({ hostname: '*.bmnw.nl', service: 'http://localhost:9999' });
        expect((await f.state()).rows).toMatchObject([{ hostname: 'a.bmnw.nl', enabled: true }, { enabled: true }]);
        expect(tunnelStore(f.home).read()?.rows[0]).toMatchObject({ hostname: 'a.bmnw.nl', enabled: false });
        expect(f.runner.running).toBe(1);
    });

    test('makes the record again when a hostname turns on after a Remove whose delete answer got lost', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const id = await rowOn(f, 'a', 3000);

        f.cloudflare.lose('DELETE /zones/zone-bmnw.nl/dns_records', 502);

        await expect(f.service.remove(id)).rejects.toBeInstanceOf(CloudflareError);

        expect(f.cloudflare.records).toEqual([]);

        await f.service.update(id, { enabled: true });
        await f.service.idle();

        expect(f.cloudflare.records).toMatchObject([{ name: 'a.bmnw.nl', comment: MARKER }]);
        expect(ourTunnel(f).ingress[0]).toEqual({ hostname: 'a.bmnw.nl', service: 'http://127.0.0.1:3000' });
        expect((await f.state()).rows).toMatchObject([{ hostname: 'a.bmnw.nl', enabled: true }]);
    });

    test('keeps a hostname that comes back meant on when looking up its record fails at boot, and brings it up on Try again', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', zone: f.bmnw.id, label: 'a', port: 3000, comeBack: true });
        await f.service.idle();
        await f.service.stop();
        f.cloudflare.failing.set('GET /zones/zone-bmnw.nl/dns_records', 503);

        const booted = await fixture({}, '/usr/bin/cloudflared', { home: f.home, cloudflare: f.cloudflare, tokens: f.tokens });

        await booted.service.resume();
        await booted.service.idle();

        expect(tunnelStore(f.home).read()?.rows[0]).toMatchObject({ hostname: 'a.bmnw.nl', enabled: true });
        expect(await booted.state()).toMatchObject({ stage: 'failed', rows: [{ hostname: 'a.bmnw.nl', enabled: true }] });

        f.cloudflare.failing.clear();
        await booted.service.retry();
        await booted.service.idle();

        expect(ourTunnel(f).ingress[0]).toEqual({ hostname: 'a.bmnw.nl', service: 'http://127.0.0.1:3000' });
        expect(await booted.state()).toMatchObject({ stage: 'running', rows: [{ hostname: 'a.bmnw.nl', enabled: true }] });
        expect(booted.runner.running).toBe(1);
    });

    test('shows a hostname on whose record Cloudflare refuses on Try again while its hostnames cannot be read', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await rowOn(f, 'a', 3000);
        f.cloudflare.failing.set('GET /zones/zone-bmnw.nl/dns_records', 403);
        f.cloudflare.failing.set(`${READ}/${ourTunnel(f).id}/configurations`, 503);
        await f.service.retry();
        await f.service.idle();

        expect(ourTunnel(f).ingress[0]).toEqual({ hostname: 'a.bmnw.nl', service: 'http://127.0.0.1:3000' });
        expect(tunnelStore(f.home).read()?.rows[0]).toMatchObject({ hostname: 'a.bmnw.nl', enabled: false });
        expect(await f.state()).toMatchObject({ stage: 'failed', rows: [{ hostname: 'a.bmnw.nl', enabled: true }] });
        expect(f.runner.running).toBe(1);
    });

    test('holds a hostname that is off with its 404 before a path of the dashboard on that hostname that takes the root', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const id = await rowOn(f, 'a', 3000);

        ourTunnel(f).ingress = [{ hostname: 'a.bmnw.nl', path: '^/', service: 'http://localhost:9000' }, ...ourTunnel(f).ingress];
        await f.service.update(id, { enabled: false });
        await f.service.idle();

        expect(ourTunnel(f).ingress).toEqual([
            { hostname: 'a.bmnw.nl', service: 'http_status:404' },
            { hostname: 'a.bmnw.nl', path: '^/', service: 'http://localhost:9000' },
            { service: 'http_status:404' }
        ]);
        expect((await f.state()).rows).toMatchObject([{ hostname: 'a.bmnw.nl', enabled: false }]);
    });

    test('deletes a record of its own under the name of a removed hostname that the row knew by another id', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const id = await rowOn(f, 'a', 3000);

        // A create whose answer got lost made a record the row never heard of.
        f.cloudflare.records[0]!.id = 'rec-lost';
        await f.service.remove(id);
        await f.service.idle();

        expect(f.cloudflare.records).toEqual([]);
        expect((await f.state()).rows).toEqual([]);
    });

    test('takes a rule for the hostname * as the catch-all, and adds no second one', async () => {
        const f = await fixture();

        await readyTunnel(f);
        ourTunnel(f).ingress = [{ hostname: '*', service: 'http_status:404' }];
        await rowOn(f, 'a', 3000);

        expect(ourTunnel(f).ingress).toEqual([
            { hostname: 'a.bmnw.nl', service: 'http://127.0.0.1:3000' },
            { hostname: '*', service: 'http_status:404' }
        ]);
    });

    test('shows a hostname on while another writer keeps putting a rule for every hostname before its 404', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const a = await rowOn(f, 'a', 3000);
        const b = await rowOn(f, 'b', 3001);
        const prependEvery = (tunnel: { ingress: Array<Record<string, unknown>> }): void => {
            tunnel.ingress = [{ hostname: '*', path: '.*', service: 'http://localhost:9999' }, ...tunnel.ingress];
        };

        await f.service.update(a, { enabled: false });
        await f.service.idle();
        f.cloudflare.writers.push(prependEvery, prependEvery);
        await f.service.update(b, { port: 3005 });
        await f.service.idle();

        expect((await f.state()).rows).toMatchObject([{ hostname: 'a.bmnw.nl', enabled: true }, { enabled: true }]);
        expect(tunnelStore(f.home).read()?.rows[0]).toMatchObject({ hostname: 'a.bmnw.nl', enabled: false });
    });
});

describe('what the section reads and offers', () => {
    test('describes every zone the API reads in a state the wire takes, on one account or each on its own', async () => {
        const oneAccount = new FakeCloudflare();
        const ownAccounts = new FakeCloudflare();

        for (let i = 0; i < 1000; i += 1) {
            oneAccount.zone(`d${i}.nl`);
            ownAccounts.zone(`d${i}.nl`, { id: `acc-${i}`, name: `Account ${i}` });
        }

        const one = await fixture({}, '/usr/bin/cloudflared', { cloudflare: oneAccount });
        const own = await fixture({}, '/usr/bin/cloudflared', { cloudflare: ownAccounts });
        const states = [await one.service.setToken(FAKE_API_TOKEN), await own.service.setToken(FAKE_API_TOKEN)];

        expect(states.map((state) => [state.zones.length, state.accounts.length, state.zoneCount])).toEqual([
            [1000, 1, 1000],
            [0, 1000, 1000]
        ]);
        expect(states.every((state) => TunnelStateSchema.safeParse(state).success)).toBe(true);
    });
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
