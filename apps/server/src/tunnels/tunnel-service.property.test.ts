import { describe, expect, test } from 'bun:test';
import { TunnelStateSchema, type TunnelState } from '@ruimte/contracts';
import { CloudflareError, type CloudflareFetch } from './cloudflare-api.ts';
import type { CloudflaredProcess } from './cloudflared-runner.ts';
import { isCatchAll, servedBy, servedFor, TunnelConfigError } from './tunnel-config.ts';
import { TunnelService } from './tunnel-service.ts';
import type { StoredRow, StoredTunnels } from './tunnel-store.ts';
import { FAKE_API_TOKEN, FakeCloudflare, FakeCloudflared, MemoryTokenStore, type FakeTunnel } from './tunnel-test-helpers.ts';

/*
 * Seeded runs of what a person, Cloudflare and another writer can do to Tunnels, one step at a time, with faults drawn per
 * step. After every step the invariants of `CLAUDE.md` are checked against what the fake Cloudflare holds and what Ruimte
 * last read of it. A failure names its seed; `RUIMTE_SEED=<seed>` runs that one alone.
 */
const SEQUENCES = 240;
const BATCH = 40;
const STEPS = 20;
const SERVING = 'http://localhost:8080';
const ROTATED_TOKEN = 'cf-api-token-rotated-9876543210';
const HOSTS = [
    { zone: 'bmnw.nl', label: 'a' },
    { zone: 'bmnw.nl', label: 'b' },
    { zone: 'passly.dev', label: 'c' },
    { zone: 'bmnw.nl', label: 'taken' }
] as const;
// The name with a record someone else made, which Ruimte refuses by design.
const FOREIGN = 'taken.bmnw.nl';
const PORTS = [3000, 3001, 4210] as const;
const DENIED = [4210, 4230];
const LISTENER_PORT = 4230;
const MARKER = 'Managed by Ruimte · f7a7';

type Rule = Record<string, unknown>;
type Random = () => number;

/* mulberry32: small, and the same numbers for the same seed everywhere. */
function random(seed: number): Random {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;

        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);

        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
    };
}

function pick<T>(next: Random, items: readonly T[]): T {
    return items[Math.floor(next() * items.length)]!;
}

function meantOn(row: StoredRow): boolean {
    return row.enabled && row.leaving !== true;
}

/* Everything of a run that outlives a restart of the daemon. */
interface Ground {
    next: Random;
    cloudflare: FakeCloudflare;
    tokens: MemoryTokenStore;
    disk: { value: StoredTunnels | null };
    listener: { on: boolean };
    counter: number;
    /* The ingress of each tunnel as Ruimte last knows it: its last read, or a write Cloudflare answered. */
    known: Map<string, Rule[]>;
    /* Each tunnel's ingress right before Ruimte's last PUT, which a writer that undoes it puts back. */
    beforePut: Map<string, Rule[]>;
    /* Hostnames the current step asks to turn on, so a write may serve them. */
    turningOn: Set<string>;
    /* Zones whose DNS records Cloudflare refused during this step, which may turn a row off. */
    refusedZones: Set<string>;
    /* Hostnames whose rule without a path another writer put on the tunnel. */
    writerHosts: Set<string>;
    /* Hostnames whose rules and records an unlink without reach left behind, as it says. */
    abandoned: Set<string>;
    log: string[];
    problems: string[];
}

/* A run with the daemon of the moment. */
interface World extends Ground {
    service: TunnelService;
    runner: FakeCloudflared;
}

/* A `cloudflared` that also notes a start while something else runs the tunnel. */
class WatchedCloudflared extends FakeCloudflared {
    private readonly world: Ground;

    constructor(world: Ground) {
        super();
        this.world = world;
    }

    override start(binary: string, args: readonly string[], onLine: (line: string) => void, env: Readonly<Record<string, string>> = {}): CloudflaredProcess {
        const world = this.world;
        const tunnelId = world.disk.value?.tunnel?.id;
        const tunnel = world.cloudflare.tunnels.find((candidate) => candidate.id === tunnelId);

        if (tunnel !== undefined && tunnel.connections > 0) {
            world.problems.push('started cloudflared while something else runs the tunnel');
        }

        if (this.running > 0) {
            world.problems.push('started a second cloudflared');
        }

        return super.start(binary, args, onLine, env);
    }
}

function tunnelOf(world: World): FakeTunnel | undefined {
    const id = world.disk.value?.tunnel?.id;

    return world.cloudflare.tunnels.find((tunnel) => tunnel.id === id);
}

function hasOurRecord(world: Ground, hostname: string): boolean {
    return world.cloudflare.records.some((record) => record.name === hostname && record.comment === MARKER);
}

/* Invariant 2: a write of Ruimte's never serves a row the person meant off or is taking off. */
function checkWrite(world: Ground, tunnelId: string, ingress: readonly Rule[]): void {
    const stored = world.disk.value;

    if (stored?.tunnel?.id !== tunnelId) {
        return;
    }

    for (const row of stored.rows) {
        if (meantOn(row) || world.turningOn.has(row.hostname)) {
            continue;
        }

        const own = ingress.find((rule) => rule.hostname === row.hostname && (rule.path === undefined || rule.path === ''));

        if (own !== undefined && servedBy(own) !== null) {
            world.problems.push(`wrote a serving rule for ${row.hostname}, meant off`);
        }

        if (hasOurRecord(world, row.hostname) && servedFor(ingress, row.hostname) !== null) {
            world.problems.push(`wrote an ingress that serves ${row.hostname}, meant off with its record standing`);
        }
    }
}

function watchedFetch(current: Ground): CloudflareFetch {
    return async (url, init) => {
        const path = new URL(url).pathname;
        const method = init.method ?? 'GET';
        const config = /\/cfd_tunnel\/([^/]+)\/configurations$/.exec(path);
        const body = typeof init.body === 'string' ? (JSON.parse(init.body) as { config?: { ingress?: Rule[] } }) : undefined;

        if (config !== null && method === 'PUT') {
            const tunnel = current.cloudflare.tunnels.find((candidate) => candidate.id === config[1]);

            checkWrite(current, config[1]!, body?.config?.ingress ?? []);
            current.beforePut.set(config[1]!, structuredClone(tunnel?.ingress ?? []));
        }

        const response = await current.cloudflare.fetch(url, init);

        if (config !== null && response.ok) {
            const ingress =
                method === 'PUT'
                    ? (body?.config?.ingress ?? [])
                    : ((await response.clone().json()) as { result: { config: { ingress: Rule[] } } }).result.config.ingress;

            current.known.set(config[1]!, structuredClone(ingress));
        }

        const zone = /^\/client\/v4\/zones\/([^/]+)\/dns_records/.exec(path);

        if (zone !== null && response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 429) {
            current.refusedZones.add(zone[1]!);
        }

        return response;
    };
}

/* A daemon over the run's disk, token and Cloudflare, as a boot or a restart makes one. */
function boot(world: Ground): Pick<World, 'service' | 'runner'> {
    const runner = new WatchedCloudflared(world);
    const service = new TunnelService({
        store: {
            read: () => (world.disk.value === null ? null : structuredClone(world.disk.value)),
            write: (value) => {
                world.disk.value = structuredClone(value);
            }
        },
        installer: { locate: async () => '/usr/bin/cloudflared', install: async () => '/usr/bin/cloudflared', impossible: () => null },
        runner,
        tokens: world.tokens,
        cloudflare: watchedFetch(world),
        machineName: () => 'Bas MacBook',
        machineId: () => 'machine-1',
        deniedPorts: () => DENIED,
        setListener: async (enabled) => {
            world.listener.on = enabled;

            return enabled ? LISTENER_PORT : null;
        },
        listenerPort: () => (world.listener.on ? LISTENER_PORT : null),
        clients: () => 0,
        discover: async () => [],
        changed: () => undefined,
        random: (bytes) => String((world.counter += 1)).padStart(bytes * 2, '0'),
        log: () => undefined,
        stopWaitMs: 50
    });

    return { service, runner };
}

/* A refusal the service gives on purpose; anything else is a defect. */
function expected(e: unknown): boolean {
    return e instanceof TunnelConfigError || e instanceof CloudflareError;
}

async function attempt(world: World, work: () => Promise<unknown>): Promise<unknown> {
    try {
        await work();

        return null;
    } catch (e) {
        if (!expected(e)) {
            world.problems.push(`threw ${String(e)}`);
        }

        return e;
    }
}

type Writer = (tunnel: FakeTunnel) => void;

function writerOf(world: World): Writer {
    const host = (): string => {
        const chosen = pick(world.next, HOSTS);

        return `${chosen.label}.${chosen.zone}`;
    };
    const service = (): string => (world.next() < 0.6 ? SERVING : 'http_status:404');
    const choice = Math.floor(world.next() * 7);

    if (choice === 0) {
        const rule = { hostname: '*.bmnw.nl', service: service() };

        return (tunnel) => {
            tunnel.ingress = [rule, ...tunnel.ingress];
        };
    }

    if (choice === 1) {
        const rule = { hostname: '*', service: SERVING };

        return (tunnel) => {
            tunnel.ingress = [rule, ...tunnel.ingress];
        };
    }

    if (choice === 2) {
        const rule = { hostname: host(), path: pick(world.next, ['^/api', '.*', '^/$']), service: 'http://localhost:7000' };

        return (tunnel) => {
            tunnel.ingress = [rule, ...tunnel.ingress];
        };
    }

    if (choice === 3) {
        const catchAll = { service: service() };

        return (tunnel) => {
            tunnel.ingress = [...tunnel.ingress.filter((rule) => !isCatchAll(rule)), catchAll];
        };
    }

    if (choice === 4) {
        return (tunnel) => {
            const before = world.beforePut.get(tunnel.id) ?? tunnel.ingress;

            for (const rule of before) {
                if (typeof rule.hostname === 'string' && rule.path === undefined) {
                    world.writerHosts.add(rule.hostname);
                }
            }

            tunnel.ingress = structuredClone(before);
        };
    }

    if (choice === 5) {
        const dropped = host();

        return (tunnel) => {
            tunnel.ingress = tunnel.ingress.filter((rule) => rule.hostname !== dropped);
        };
    }

    return (tunnel) => {
        tunnel.ingress = tunnel.ingress.filter((rule) => rule.path === undefined && (rule.hostname === undefined || !String(rule.hostname).startsWith('*')));
    };
}

/* Faults for one step: refusals and failures by path, lost answers and writers right after a PUT. */
function injectFaults(world: World): void {
    const { next, cloudflare } = world;
    const tunnelId = world.disk.value?.tunnel?.id ?? 'none';
    const keys = [
        `PUT /accounts/acc-1/cfd_tunnel/${tunnelId}/configurations`,
        `GET /accounts/acc-1/cfd_tunnel/${tunnelId}/configurations`,
        `GET /accounts/acc-1/cfd_tunnel/${tunnelId}`,
        'GET /zones/zone-bmnw.nl/dns_records',
        'POST /zones/zone-bmnw.nl/dns_records',
        'PUT /zones/zone-bmnw.nl/dns_records',
        'DELETE /zones/zone-bmnw.nl/dns_records',
        'POST /zones/zone-passly.dev/dns_records',
        'GET /zones'
    ];

    if (next() < 0.25) {
        const key = pick(next, keys);
        // A 404 says the tunnel or the record is gone, which Cloudflare never answers for one that stands.
        const status = pick(next, key.includes('dns_records') && !key.startsWith('DELETE') ? [401, 403, 404, 429, 500, 503] : [401, 403, 429, 500, 503]);

        cloudflare.failing.set(key, status);
        world.log.push(`  fail ${key} ${status}`);
    }

    if (next() < 0.25) {
        const key = pick(next, keys);
        const status = pick(next, [null, 502, 503]);
        const skip = Math.floor(next() * 3);

        cloudflare.lose(key, status, skip);
        world.log.push(`  lose ${key} ${String(status)} after ${skip}`);
    }

    if (next() < 0.3) {
        const count = 1 + Math.floor(next() * 3);

        for (let i = 0; i < count; i++) {
            cloudflare.writers.push(writerOf(world));
        }

        world.log.push(`  ${count} writers`);
    }
}

interface Intent {
    enabled: boolean;
    leaving: boolean;
    comeBack: boolean;
    zoneId: string;
    hostname: string;
}

function intents(world: World): Map<string, Intent> {
    return new Map(
        (world.disk.value?.rows ?? []).map((row) => [
            row.id,
            { enabled: row.enabled, leaving: row.leaving === true, comeBack: row.comeBack, zoneId: row.zoneId, hostname: row.hostname }
        ])
    );
}

/* Invariant 3: only a person's step changes the intent of a row it targets; any other row may only leave, or go off on a refusal of its own. */
function checkIntent(world: World, before: Map<string, Intent>, tunnelWasLeaving: boolean, targets: 'all' | ReadonlySet<string>, restart: boolean): void {
    const after = intents(world);

    if (targets === 'all') {
        return;
    }

    for (const [id, now] of after) {
        if (!before.has(id) && !targets.has(id)) {
            world.problems.push(`row ${now.hostname} appeared on a step that added none`);
        }
    }

    for (const [id, was] of before) {
        if (targets.has(id)) {
            continue;
        }

        const now = after.get(id);

        if (now === undefined) {
            if (!was.leaving && !tunnelWasLeaving) {
                world.problems.push(`row ${was.hostname} was dropped without a Remove`);
            }

            continue;
        }

        if (now.leaving !== was.leaving) {
            world.problems.push(`row ${was.hostname} changed leaving without a person`);
        }

        if (now.enabled && !was.enabled) {
            world.problems.push(`row ${was.hostname} turned on without a person`);
        }

        const refused = world.refusedZones.has(was.zoneId) || was.hostname === FOREIGN;

        if (was.enabled && !now.enabled && !refused && !(restart && !was.comeBack)) {
            world.problems.push(`row ${was.hostname} turned off without a person or a refusal of its own`);
        }
    }
}

/* Invariants 1 and 5, on what the screen shows after the step settled. */
async function checkState(world: World): Promise<void> {
    const state: TunnelState = await world.service.state();
    const parsed = TunnelStateSchema.safeParse(state);

    if (!parsed.success) {
        world.problems.push('the state does not fit the wire');
    }

    const tunnelId = world.disk.value?.tunnel?.id;
    const known = tunnelId === undefined ? undefined : world.known.get(tunnelId);

    // Without a record of Ruimte's under the name no request reaches the tunnel, whatever its ingress says.
    if (known !== undefined) {
        for (const row of state.rows) {
            if (!row.enabled && hasOurRecord(world, row.hostname) && servedFor(known, row.hostname) !== null) {
                world.problems.push(`shows ${row.hostname} off while the ingress Ruimte last read serves it`);
            }
        }
    }

    if (world.runner.running > 1) {
        world.problems.push(`runs ${world.runner.running} cloudflared`);
    }

    if (world.runner.running > 0) {
        if (state.tunnel?.runner !== 'ruimte') {
            world.problems.push('runs cloudflared while the state says another runner');
        }

        if (!state.rows.some((row) => row.enabled)) {
            world.problems.push('runs cloudflared while no row is on or served');
        }

        if (!state.hasToken) {
            world.problems.push('runs cloudflared without a token');
        }
    }
}

/* Invariant 4: what a finished Remove or unlink took off is gone from Cloudflare, as far as Ruimte knows it. */
function checkGone(world: World, tunnelId: string, hostnames: readonly string[]): void {
    const known = world.known.get(tunnelId) ?? [];

    for (const hostname of hostnames) {
        if (hasOurRecord(world, hostname)) {
            world.problems.push(`left a record of ${hostname} behind`);
        }

        if (known.some((rule) => rule.hostname === hostname && rule.path === undefined)) {
            world.problems.push(`left a rule of ${hostname} behind`);
        }
    }
}

function zoneIdOf(world: World, name: string): string {
    return world.cloudflare.zones.find((zone) => zone.name === name)!.id;
}

function rowsOf(world: World): StoredRow[] {
    return world.disk.value?.rows ?? [];
}

/* Draws one step and runs it with its faults, then checks the invariants. */
async function step(world: World): Promise<void> {
    const { next, service } = world;
    const before = intents(world);
    const tunnelWasLeaving = world.disk.value?.tunnel?.leaving === true;
    const rows = rowsOf(world);
    const row = rows.length === 0 ? undefined : pick(next, rows);
    const draw = next() * 22;
    let targets: 'all' | ReadonlySet<string> = new Set();
    let restart = false;

    world.turningOn.clear();
    world.refusedZones.clear();
    injectFaults(world);

    if (world.disk.value?.tunnel == null && draw < 8) {
        if (next() < 0.5) {
            world.log.push('setup');
            await attempt(world, () => service.setup());
        } else {
            const tunnel = pick(next, world.cloudflare.tunnels);

            world.log.push(`link ${tunnel.name}`);
            await attempt(world, () => service.link(undefined, tunnel.id));
        }
    } else if (draw < 5) {
        const host = pick(next, HOSTS);
        const kind = next() < 0.2 ? 'mcp' : 'dev';
        const port = pick(next, PORTS);
        const hostname = `${host.label}.${host.zone}`;

        world.log.push(`add ${kind} ${hostname}${kind === 'dev' ? `:${port}` : ''}`);
        world.turningOn.add(hostname);

        const ids = new Set(before.keys());
        const failed = await attempt(world, () =>
            service.add({ kind, zone: zoneIdOf(world, host.zone), label: host.label, ...(kind === 'dev' ? { port } : {}), comeBack: next() < 0.5 })
        );

        targets = new Set(
            rowsOf(world)
                .filter((candidate) => !ids.has(candidate.id))
                .map((candidate) => candidate.id)
        );

        const refusedBy = failed instanceof TunnelConfigError ? failed.code : null;

        const leftBy = refusedBy === 'hostname-on-tunnel' ? !world.writerHosts.has(hostname) : refusedBy === 'other-machine';

        if (leftBy && !world.abandoned.has(hostname)) {
            world.problems.push(`add of ${hostname} refused with ${refusedBy} by what Ruimte left behind`);
        }
    } else if (draw < 10 && row !== undefined) {
        const change = Math.floor(next() * 4);
        const update =
            change === 0
                ? { enabled: !row.enabled || row.leaving === true }
                : change === 1
                  ? { port: pick(next, PORTS) }
                  : change === 2
                    ? { origin: next() < 0.5 ? { https: true } : {} }
                    : { enabled: next() < 0.5, port: pick(next, PORTS) };

        world.log.push(`update ${row.hostname} ${JSON.stringify(update)}`);

        if (update.enabled === true) {
            world.turningOn.add(row.hostname);
        }

        targets = new Set([row.id]);
        await attempt(world, () => service.update(row.id, update));
    } else if (draw < 12 && row !== undefined) {
        const tunnelId = world.disk.value?.tunnel?.id ?? '';

        world.log.push(`remove ${row.hostname}`);
        targets = new Set([row.id]);

        const failed = await attempt(world, () => service.remove(row.id));

        if (failed === null && !rowsOf(world).some((candidate) => candidate.id === row.id)) {
            checkGone(world, tunnelId, [row.hostname]);
        }
    } else if (draw < 12.7 && world.disk.value?.tunnel != null) {
        const tunnelId = world.disk.value.tunnel.id;
        const hostnames = rows.map((candidate) => candidate.hostname);

        world.log.push('unlink');
        targets = 'all';

        const failed = await attempt(world, () => service.unlink());
        const state = await service.state();

        if (failed === null && state.tunnel === null) {
            if (state.message?.includes('stay in Cloudflare') === true) {
                hostnames.forEach((hostname) => world.abandoned.add(hostname));
            } else {
                checkGone(world, tunnelId, hostnames);
            }
        }
    } else if (draw < 13.5) {
        const enabled = !world.listener.on;

        world.log.push(`mcp ${enabled}`);
        await attempt(world, () => service.setMcp(enabled));
    } else if (draw < 16) {
        world.log.push('retry');
        await attempt(world, () => service.retry());
    } else if (draw < 17) {
        world.log.push('network back');
        service.networkBack();
    } else if (draw < 18.5) {
        world.log.push('restart');
        restart = true;
        await world.service.stop();

        if (world.runner.running > 0) {
            world.problems.push('a stopped daemon left cloudflared running');
        }

        world.known.clear();
        Object.assign(world, boot(world));
        await attempt(world, () => world.service.resume());
    } else if (draw < 18.8) {
        world.log.push('clear token');
        await attempt(world, () => service.clearToken());
    } else if (draw < 19.6) {
        const token = next() < 0.5 ? FAKE_API_TOKEN : ROTATED_TOKEN;

        world.log.push(`token ${token === FAKE_API_TOKEN ? 'first' : 'rotated'}`);
        world.cloudflare.acceptedToken = token;
        await attempt(world, () => service.setToken(token));
    } else if (draw < 19.9) {
        world.log.push('revoke token');
        world.cloudflare.acceptedToken = 'revoked';
    } else if (draw < 21) {
        const tunnel = tunnelOf(world);
        const writer = writerOf(world);

        world.log.push('dashboard edit');

        if (tunnel !== undefined) {
            writer(tunnel);
        }
    } else {
        const tunnel = tunnelOf(world);

        world.log.push('other runner');

        if (tunnel !== undefined) {
            tunnel.connections = tunnel.connections > 0 ? 0 : 1;
        }
    }

    await world.service.idle();
    world.cloudflare.failing.clear();
    world.cloudflare.writers.length = 0;
    world.turningOn.clear();
    checkIntent(world, before, tunnelWasLeaving, targets, restart);
    await checkState(world);
}

async function sequence(seed: number): Promise<string[]> {
    const cloudflare = new FakeCloudflare();
    const bmnw = cloudflare.zone('bmnw.nl');

    cloudflare.zone('passly.dev');
    cloudflare.record(bmnw, { name: FOREIGN });
    cloudflare.tunnel('acc-1', 'home', [{ service: SERVING }]);

    const ground: Ground = {
        next: random(seed),
        cloudflare,
        tokens: new MemoryTokenStore(),
        disk: { value: null },
        listener: { on: false },
        counter: 0,
        known: new Map(),
        beforePut: new Map(),
        turningOn: new Set(),
        refusedZones: new Set(),
        writerHosts: new Set(),
        abandoned: new Set(),
        log: [],
        problems: []
    };
    const world: World = Object.assign(ground, boot(ground));

    await world.service.setToken(FAKE_API_TOKEN);

    for (let i = 0; i < STEPS && world.problems.length === 0; i++) {
        await step(world);
    }

    await world.service.stop();

    return world.problems.length === 0 ? [] : [`seed ${seed}: ${[...new Set(world.problems)].join('; ')}\n  after ${world.log.join('\n  ')}`];
}

const only = process.env.RUIMTE_SEED === undefined ? null : Number(process.env.RUIMTE_SEED);
const batches = only === null ? Array.from({ length: SEQUENCES / BATCH }, (_, batch) => batch * BATCH) : [only];

describe('TunnelService under seeded steps and faults', () => {
    test.each(batches)('keeps its invariants from seed %i on', async (first) => {
        const failures: string[] = [];

        for (let seed = first; seed < first + (only === null ? BATCH : 1); seed++) {
            failures.push(...(await sequence(seed)));
        }

        expect(failures).toEqual([]);
    });
});
