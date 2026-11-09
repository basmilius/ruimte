import { describe, expect, test } from 'bun:test';
import { TunnelStateSchema, type TunnelState } from '@ruimte/contracts';
import { CloudflareError, type CloudflareFetch } from './cloudflare-api.ts';
import type { CloudflaredProcess } from './cloudflared-runner.ts';
import { TunnelConfigError } from './tunnel-config.ts';
import { TunnelService } from './tunnel-service.ts';
import type { StoredRow, StoredTunnels } from './tunnel-store.ts';
import { FAKE_API_TOKEN, FakeCloudflare, FakeCloudflared, MemoryTokenStore, type FakeTunnel } from './tunnel-test-helpers.ts';

/*
 * Seeded runs of what a person, Cloudflare and another writer can do to Tunnels, one step at a time, with faults drawn per
 * step. After every step the invariants of `CLAUDE.md` are checked against what the fake Cloudflare holds and what Ruimte
 * last read of it, and every run ends at rest: a Try again without faults, after which Cloudflare serves exactly what the
 * person meant. What Cloudflare serves is judged by a matcher of this file's own. The ports Ruimte listens on change
 * between steps, as when it starts listening on a dev server's port, another app may hold the listener's port, and the
 * dashboard may delete the record of a row that is on. A failure names its seed;
 * `RUIMTE_SEED=<seed>` runs that one alone, and `RUIMTE_SEQUENCES=<count>` searches more.
 */
const SEQUENCES = Number(process.env.RUIMTE_SEQUENCES ?? 1200);
const BATCH = 40;
const STEPS = 30;
const SERVING = 'http://localhost:8080';
const ROTATED_TOKEN = 'cf-api-token-rotated-9876543210';
const HOSTS = [
    { zone: 'bmnw.nl', label: 'a' },
    { zone: 'bmnw.nl', label: 'b' },
    { zone: 'passly.dev', label: 'c' },
    { zone: 'passly.dev', label: 'd' },
    { zone: 'bmnw.nl', label: 'taken' }
] as const;
// The name with a record someone else made, which Ruimte refuses by design.
const FOREIGN = 'taken.bmnw.nl';
const PORTS = [3000, 3001, 3002, 4210] as const;
const DENIED = [4210, 4230];
const LISTENER_PORT = 4230;
const MARKER = 'Managed by Ruimte · f7a7';
const PATHS = ['/', '/api/x', '/static/a.js'] as const;
const WRITER_PATHS = ['^/api', '.*', '^/$', '^/static'] as const;

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

function hostMatches(pattern: unknown, hostname: string): boolean {
    if (pattern === undefined || pattern === '' || pattern === '*') {
        return true;
    }

    if (typeof pattern !== 'string') {
        return false;
    }

    return pattern.startsWith('*.') ? hostname.endsWith(pattern.slice(1)) : pattern === hostname;
}

function pathMatches(pattern: unknown, path: string): boolean {
    return pattern === undefined || pattern === '' || new RegExp(String(pattern)).test(path);
}

/* The rule `cloudflared` answers a request with: the first in order whose hostname and path both match it. */
function ruleFor(ingress: readonly Rule[], hostname: string, path: string): Rule | undefined {
    return ingress.find((rule) => hostMatches(rule.hostname, hostname) && pathMatches(rule.path, path));
}

function serves(rule: Rule | undefined): boolean {
    return rule !== undefined && !String(rule.service).startsWith('http_status:');
}

/* The paths of `PATHS` a request for the hostname reaches an origin on. */
function servedPaths(ingress: readonly Rule[], hostname: string): string[] {
    return PATHS.filter((path) => serves(ruleFor(ingress, hostname, path)));
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
    /* Hostnames another writer put a rule for on the tunnel. */
    writerHosts: Set<string>;
    /* Hostnames whose rules and records an unlink without reach left behind, as it says. */
    abandoned: Set<string>;
    /* Calls to Cloudflare until the tunnel is deleted in the dashboard, or null. */
    vanishIn: number | null;
    /* The ports Ruimte listens on now, which a step may change, as when Ruimte starts listening on a dev server's port. */
    denied: number[];
    /* Something else holds the listener's port this step, so starting the listener fails as Bun does on a port in use. */
    portTaken: boolean;
    /* Hostnames whose record was deleted in the dashboard while their row was on, until Ruimte looked the name up. */
    deletedOutside: Set<string>;
    /* The step drew a fault other than a failed DNS read or one that may pass (a 5xx, a 429, a lost answer). */
    harsh: boolean;
    /* The run draws its steps from `FOCUSED`, with more faults. */
    focused: boolean;
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

function tunnelOf(world: Ground): FakeTunnel | undefined {
    const id = world.disk.value?.tunnel?.id;

    return world.cloudflare.tunnels.find((tunnel) => tunnel.id === id);
}

function hasOurRecord(world: Ground, hostname: string): boolean {
    return world.cloudflare.records.some((record) => record.name === hostname && record.comment === MARKER);
}

/* Invariant 2: a write of Ruimte's never serves a row the person meant off or is taking off, on any path. */
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
        const paths = servedPaths(ingress, row.hostname);

        if (serves(own)) {
            world.problems.push(`wrote a serving rule for ${row.hostname}, meant off`);
        }

        if (hasOurRecord(world, row.hostname) && paths.length > 0) {
            world.problems.push(`wrote an ingress that serves ${row.hostname} at ${paths.join(' ')}, meant off with its record standing`);
        }
    }
}

/*
 * Invariant 9: a DNS record of Ruimte's goes out (made, or proxied again) only while the first rule Cloudflare takes for
 * its hostname on every path, as Ruimte last read it, is Ruimte's own rule for that row: its 404 or its serving rule,
 * never a rule of someone else's or nothing. A person's rule with a path on the hostname itself may come first only
 * while Ruimte's rule serves.
 */
function checkPublication(world: Ground, hostname: string): void {
    const tunnelId = world.disk.value?.tunnel?.id;
    const known = tunnelId === undefined ? undefined : world.known.get(tunnelId);

    if (!(world.disk.value?.rows ?? []).some((row) => row.hostname === hostname)) {
        world.problems.push(`published a record of ${hostname} without a row`);

        return;
    }

    if (known === undefined) {
        world.problems.push(`published a record of ${hostname} without having read the tunnel`);

        return;
    }

    const own = known.find((rule) => rule.hostname === hostname && (rule.path === undefined || rule.path === ''));

    for (const path of PATHS) {
        const rule = ruleFor(known, hostname, path);
        const persons = rule !== undefined && rule.hostname === hostname && rule !== own && serves(own);

        if (own === undefined || (rule !== own && !persons)) {
            world.problems.push(`published a record of ${hostname} while ${String(rule?.hostname ?? rule?.service ?? 'nothing')} takes ${path}`);

            return;
        }
    }
}

function watchedFetch(current: Ground): CloudflareFetch {
    return async (url, init) => {
        const path = new URL(url).pathname;
        const method = init.method ?? 'GET';
        const config = /\/cfd_tunnel\/([^/]+)\/configurations$/.exec(path);
        const body = typeof init.body === 'string' ? (JSON.parse(init.body) as { config?: { ingress?: Rule[] }; name?: string }) : undefined;

        if (/\/dns_records(\/[^/]+)?$/.test(path) && (method === 'POST' || method === 'PUT') && body?.name !== undefined) {
            checkPublication(current, body.name);
        }

        if (current.vanishIn !== null && (current.vanishIn -= 1) <= 0) {
            const gone = tunnelOf(current);

            current.vanishIn = null;

            if (gone !== undefined) {
                current.cloudflare.tunnels.splice(current.cloudflare.tunnels.indexOf(gone), 1);
                current.log.push(`  (the tunnel is deleted in the dashboard)`);
            }
        }

        if (config !== null && method === 'PUT') {
            const tunnel = current.cloudflare.tunnels.find((candidate) => candidate.id === config[1]);

            checkWrite(current, config[1]!, body?.config?.ingress ?? []);
            current.beforePut.set(config[1]!, structuredClone(tunnel?.ingress ?? []));
        }

        const response = await current.cloudflare.fetch(url, init);
        const looked = new URL(url).searchParams.get('name');

        if (method === 'GET' && path.endsWith('/dns_records') && looked !== null && response.ok) {
            current.deletedOutside.delete(looked);
        }

        if (config !== null && response.ok) {
            const ingress =
                method === 'PUT'
                    ? (body?.config?.ingress ?? [])
                    : ((await response.clone().json()) as { result: { config: { ingress: Rule[] } } }).result.config.ingress;

            current.known.set(config[1]!, structuredClone(ingress));
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
        deniedPorts: () => world.denied,
        setListener: async (enabled) => {
            if (enabled && world.portTaken) {
                throw new Error(`Failed to start server. Is port ${LISTENER_PORT} in use?`);
            }

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
        const rule = { hostname: host(), path: pick(world.next, WRITER_PATHS), service: 'http://localhost:7000' };

        return (tunnel) => {
            world.writerHosts.add(rule.hostname);
            tunnel.ingress = [rule, ...tunnel.ingress];
        };
    }

    if (choice === 3) {
        const catchAll = { service: service() };

        return (tunnel) => {
            tunnel.ingress = [...tunnel.ingress.filter((rule) => !(rule.hostname === undefined && rule.path === undefined)), catchAll];
        };
    }

    if (choice === 4) {
        return (tunnel) => {
            const before = world.beforePut.get(tunnel.id) ?? tunnel.ingress;

            for (const rule of before) {
                if (typeof rule.hostname === 'string') {
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

/* Faults for one step: refusals and failures by path, lost answers, writers right after a PUT, a zone the token loses and the tunnel deleted. */
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
        'GET /zones/zone-passly.dev/dns_records',
        'POST /zones/zone-passly.dev/dns_records',
        'DELETE /zones/zone-passly.dev/dns_records',
        'GET /zones'
    ];

    // A focused run fails more, so a restart's bring-up often leaves a row without its record.
    const odds = world.focused ? 0.45 : 0.25;

    if (next() < odds) {
        const key = pick(next, keys);
        // A 404 says the tunnel or the record is gone, which Cloudflare never answers for one that stands.
        const status = pick(next, key.includes('dns_records') && !key.startsWith('DELETE') ? [401, 403, 404, 429, 500, 503] : [401, 403, 429, 500, 503]);

        cloudflare.failing.set(key, status);
        world.log.push(`  fail ${key} ${status}`);

        if (!(key.startsWith('GET /zones/') || status === 429 || status >= 500)) {
            world.harsh = true;
        }
    }

    if (next() < odds) {
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
        world.harsh = true;
    }

    if (next() < 0.1) {
        const zone = pick(next, cloudflare.zones);

        cloudflare.hidden.add(zone.id);
        world.log.push(`  token loses ${zone.name}`);
    }

    if (next() < 0.03 && world.disk.value?.tunnel != null) {
        world.vanishIn = 1 + Math.floor(next() * 8);
        world.log.push(`  tunnel deleted after ${world.vanishIn} calls`);
        world.harsh = true;
    }

    world.portTaken = next() < 0.15;

    if (world.portTaken) {
        world.log.push('  listener port taken');
    }
}

interface Intent {
    enabled: boolean;
    leaving: boolean;
    comeBack: boolean;
    hostname: string;
}

function intents(world: World): Map<string, Intent> {
    return new Map(
        (world.disk.value?.rows ?? []).map((row) => [
            row.id,
            { enabled: row.enabled, leaving: row.leaving === true, comeBack: row.comeBack, hostname: row.hostname }
        ])
    );
}

/*
 * Invariant 3: only a person's step changes the intent of a row it targets; any other row may only leave by a Remove or
 * unlink, or go when Ruimte forgets a tunnel deleted in the dashboard. Nothing Cloudflare says turns a row off.
 */
function checkIntent(
    world: World,
    before: Map<string, Intent>,
    tunnelBefore: { id: string; leaving: boolean } | null,
    targets: 'all' | ReadonlySet<string>,
    restart: boolean
): void {
    const after = intents(world);
    const tunnelWasLeaving = tunnelBefore?.leaving === true;
    const forgotten = tunnelBefore !== null && world.disk.value?.tunnel == null && !world.cloudflare.tunnels.some((tunnel) => tunnel.id === tunnelBefore.id);

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
            if (!was.leaving && !tunnelWasLeaving && !forgotten) {
                world.problems.push(`row ${was.hostname} was dropped without a Remove`);
            }

            if (forgotten) {
                world.abandoned.add(was.hostname);
            }

            continue;
        }

        if (now.leaving !== was.leaving) {
            world.problems.push(`row ${was.hostname} changed leaving without a person`);
        }

        if (now.enabled && !was.enabled) {
            world.problems.push(`row ${was.hostname} turned on without a person`);
        }

        if (was.enabled && !now.enabled && !(restart && !was.comeBack)) {
            world.problems.push(`row ${was.hostname} turned off without a person`);
        }
    }
}

/* Whether a dev row points at a port Ruimte listens on now, which Ruimte holds with its 404 by design. */
function deniedRow(world: Ground, row: Pick<StoredRow, 'kind' | 'port'>): boolean {
    return row.kind === 'dev' && world.denied.includes(row.port ?? 0);
}

/* What Ruimte's own rule for a hostname is on the tunnel in Cloudflare, or undefined without one. */
function ownRule(tunnel: FakeTunnel, hostname: string): Rule | undefined {
    return tunnel.ingress.find((rule) => rule.hostname === hostname && rule.path === undefined);
}

/*
 * Rows meant on, with a record Ruimte knows by its id, that Ruimte's own rule serves now: what a step whose faults may
 * pass must leave serving. A record made by a create whose answer got lost is one Ruimte holds the row off for by design.
 */
function healthyRows(world: World): Set<string> {
    const tunnel = tunnelOf(world);

    if (tunnel === undefined) {
        return new Set();
    }

    const known = (row: StoredRow): boolean =>
        world.cloudflare.records.some((record) => record.id === row.recordId && record.name === row.hostname && record.comment === MARKER);

    return new Set(
        rowsOf(world)
            .filter((row) => meantOn(row) && (row.kind === 'dev' || world.listener.on) && known(row) && serves(ownRule(tunnel, row.hostname)))
            .map((row) => row.id)
    );
}

/* Invariant 7: a failed DNS read or a fault that may pass never takes a healthy row off the air. */
function checkAvailable(world: World, healthy: ReadonlySet<string>): void {
    const tunnel = tunnelOf(world);

    if (tunnel === undefined) {
        return;
    }

    for (const row of rowsOf(world)) {
        if (!healthy.has(row.id) || !meantOn(row) || deniedRow(world, row) || (row.kind === 'mcp' && !world.listener.on)) {
            continue;
        }

        const rule = ownRule(tunnel, row.hostname);

        if (rule !== undefined && !serves(rule)) {
            world.problems.push(`held ${row.hostname} on a 404 after a step whose faults were only DNS reads or ones that may pass`);
        }
    }
}

/* Invariants 1, 5 and 8, on what the screen shows after the step settled. */
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
            const paths = servedPaths(known, row.hostname);
            const stored = rowsOf(world).find((candidate) => candidate.id === row.id);
            // The MCP the person has on counts also while its listener did not start, which the row has to say.
            const meant = row.kind === 'dev' || world.disk.value?.mcp.enabled === true;
            // A record deleted in the dashboard is unknown to Ruimte until it looks the name up again.
            const unrecorded = !hasOurRecord(world, row.hostname) && !world.deletedOutside.has(row.hostname);

            if (!row.enabled && hasOurRecord(world, row.hostname) && paths.length > 0) {
                world.problems.push(`shows ${row.hostname} off while the ingress Ruimte last read serves it at ${paths.join(' ')}`);
            }

            // A row the person sees on that serves nothing says why, after the job that found it ended.
            if (row.enabled && stored !== undefined && meantOn(stored) && meant && (paths.length === 0 || unrecorded) && row.reason === undefined) {
                world.problems.push(`shows ${row.hostname} on without a reason while Cloudflare does not serve it`);
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

        if (!state.rows.some((row) => row.enabled && (row.kind === 'dev' || world.listener.on))) {
            world.problems.push('runs cloudflared while no row is on or served');
        }

        if (!state.hasToken) {
            world.problems.push('runs cloudflared without a token');
        }
    }
}

/* Invariant 10: Try again or the network coming back starts the listener the person turned on while its port is free. */
function checkListener(world: World): void {
    if (world.disk.value?.mcp.enabled === true && !world.portTaken && !world.listener.on) {
        world.problems.push('left the MCP listener down after a retry while its port is free');
    }
}

/* Invariant 4: what a finished Remove or unlink took off is gone from Cloudflare, as far as Ruimte knows it. */
function checkGone(world: World, tunnelId: string, hostnames: readonly string[]): void {
    // A tunnel deleted in the dashboard took its rules along.
    const known = world.cloudflare.tunnels.some((tunnel) => tunnel.id === tunnelId) ? (world.known.get(tunnelId) ?? []) : [];

    for (const hostname of hostnames) {
        if (hasOurRecord(world, hostname)) {
            world.problems.push(`left a record of ${hostname} behind`);
        }

        if (known.some((rule) => rule.hostname === hostname && rule.path === undefined)) {
            world.problems.push(`left a rule of ${hostname} behind`);
        }
    }
}

/* What the rule of a row meant on points at, or null when it serves nothing (the MCP while its listener is off). */
function serviceOf(world: World, row: StoredRow): string | null {
    if (row.kind === 'mcp') {
        return world.listener.on ? `http://127.0.0.1:${LISTENER_PORT}` : null;
    }

    if (deniedRow(world, row)) {
        return null;
    }

    return `${row.origin?.https === true ? 'https' : 'http'}://127.0.0.1:${row.port}`;
}

/*
 * Invariant 6, at rest after a Try again without faults: Cloudflare serves exactly what the person meant. A row meant on
 * has its record and serves its port on every path a person's own rule with a path on its hostname leaves to it, a row
 * meant off serves nothing, nothing is still leaving, and no record or rule of this machine is left without a row.
 */
function checkConverged(world: World, state: TunnelState): void {
    const stored = world.disk.value;
    const rows = stored?.rows ?? [];
    const tunnel = tunnelOf(world);
    const kept = new Set(rows.map((row) => row.hostname));
    const ourHosts = new Set(HOSTS.map((host) => `${host.label}.${host.zone}`));

    if (stored?.tunnel != null && tunnel === undefined) {
        world.problems.push('keeps a tunnel that is gone from Cloudflare');
    }

    if (stored?.tunnel?.leaving === true) {
        world.problems.push('has not finished unlinking');
    }

    if (stored?.mcp.enabled === true && !world.listener.on) {
        world.problems.push('has the MCP on without its listener once its port is free');
    }

    for (const row of rows) {
        if (row.leaving === true) {
            world.problems.push(`still has ${row.hostname} leaving`);
        }

        if (tunnel === undefined) {
            continue;
        }

        if (!meantOn(row)) {
            const paths = servedPaths(tunnel.ingress, row.hostname);

            if (hasOurRecord(world, row.hostname) && paths.length > 0) {
                world.problems.push(`serves ${row.hostname} at ${paths.join(' ')}, meant off`);
            }

            continue;
        }

        if (!hasOurRecord(world, row.hostname)) {
            world.problems.push(`has no record of ${row.hostname}, meant on`);
        }

        const wanted = serviceOf(world, row);

        for (const path of PATHS) {
            const rule = ruleFor(tunnel.ingress, row.hostname, path);
            const persons = rule !== undefined && rule.hostname === row.hostname && rule.path !== undefined;

            if (!persons && (wanted === null ? serves(rule) : rule?.service !== wanted)) {
                world.problems.push(`serves ${row.hostname}${path} with ${String(rule?.service)}, meant ${String(wanted)}`);
            }
        }
    }

    for (const record of world.cloudflare.records) {
        const target = world.cloudflare.tunnels.some((candidate) => record.content === `${candidate.id}.cfargotunnel.com`);

        if (record.comment === MARKER && target && !kept.has(record.name) && !world.abandoned.has(record.name)) {
            world.problems.push(`left the record of ${record.name} without a row`);
        }
    }

    for (const candidate of world.cloudflare.tunnels) {
        for (const rule of candidate.ingress) {
            const hostname = typeof rule.hostname === 'string' ? rule.hostname : '';
            const ours = candidate === tunnel && kept.has(hostname);

            if (ourHosts.has(hostname) && rule.path === undefined && !ours && !world.writerHosts.has(hostname) && !world.abandoned.has(hostname)) {
                world.problems.push(`left the rule of ${hostname} on ${candidate.name} without a row`);
            }
        }
    }

    // Invariant 5 the other way: with something live and no other runner, the child runs.
    const live = state.rows.some((row) => row.enabled && (row.kind === 'dev' ? !deniedRow(world, row) : world.listener.on));

    if (tunnel !== undefined && live && tunnel.connections === 0 && world.runner.running === 0) {
        world.problems.push('runs no cloudflared while a row is on and nothing else runs the tunnel');
    }
}

/* The person fixes what was wrong (a token Cloudflare takes) and presses Try again with every fault gone. */
async function rest(world: World): Promise<void> {
    world.cloudflare.heal();
    world.vanishIn = null;
    world.portTaken = false;

    const token = world.tokens.read();

    if (token === null || token !== world.cloudflare.acceptedToken) {
        world.log.push('at rest: token first');
        world.cloudflare.acceptedToken = FAKE_API_TOKEN;
        await attempt(world, () => world.service.setToken(FAKE_API_TOKEN));
    } else {
        world.log.push('at rest: retry');
        await attempt(world, () => world.service.retry());
    }

    await world.service.idle();
    await checkState(world);
    checkConverged(world, await world.service.state());
}

function zoneIdOf(world: World, name: string): string {
    return world.cloudflare.zones.find((zone) => zone.name === name)!.id;
}

function rowsOf(world: World): StoredRow[] {
    return world.disk.value?.rows ?? [];
}

/*
 * The draws of a focused run: restarts and records deleted in the dashboard, then jobs that bring nothing up (the MCP
 * switch, add, update, Remove), since a restart forgets every reason Ruimte kept in memory.
 */
const FOCUSED: ReadonlyArray<readonly [number, number]> = [
    [17, 18.5],
    [17, 18.5],
    [17, 18.5],
    [22, 23],
    [22, 23],
    [0, 7],
    [0, 7],
    [13, 13.6],
    [7, 11],
    [11, 12.5]
];

function focusedDraw(world: World): number {
    // Without a row, an update or Remove would fall through to an unlink, which ends the run's tunnel.
    const [from, to] = pick(world.next, rowsOf(world).length === 0 ? FOCUSED.slice(5, 6) : FOCUSED);

    return from + world.next() * (to - from);
}

/* Draws one step and runs it with its faults, then checks the invariants. */
async function step(world: World): Promise<void> {
    const { next, service } = world;
    const before = intents(world);
    const stored = world.disk.value?.tunnel;
    const tunnelBefore = stored == null ? null : { id: stored.id, leaving: stored.leaving === true };
    const rows = rowsOf(world);
    const row = rows.length === 0 ? undefined : pick(next, rows);
    const kept = world.tokens.read();
    // A person whose token is gone or refused soon pastes one, or most runs would end without a tunnel to judge.
    const draw = (kept === null || kept !== world.cloudflare.acceptedToken) && next() < 0.3 ? 19 : world.focused ? focusedDraw(world) : next() * 24;
    const healthy = healthyRows(world);
    // A port of Ruimte's refuses only the row that names it.
    const refusedForPort = (failed: unknown, port: number | null): void => {
        if (failed instanceof TunnelConfigError && failed.code === 'port-denied' && !world.denied.includes(port ?? 0)) {
            world.problems.push(`refused a step with port-denied, while its own port ${String(port)} is free`);
        }
    };
    let targets: 'all' | ReadonlySet<string> = new Set();
    let restart = false;

    world.turningOn.clear();
    world.harsh = false;
    injectFaults(world);

    if (world.disk.value?.tunnel == null && draw < 8) {
        if (next() < 0.5 || world.cloudflare.tunnels.length === 0) {
            world.log.push('setup');
            await attempt(world, () => service.setup());
        } else {
            const tunnel = pick(next, world.cloudflare.tunnels);

            world.log.push(`link ${tunnel.name}`);
            await attempt(world, () => service.link(undefined, tunnel.id));
        }
    } else if (draw < 7) {
        const host = pick(next, HOSTS);
        const kind = next() < 0.2 ? 'mcp' : 'dev';
        const port = pick(next, PORTS);
        const hostname = `${host.label}.${host.zone}`;

        world.log.push(`add ${kind} ${hostname}${kind === 'dev' ? `:${port}` : ''}`);
        world.turningOn.add(hostname);

        const ids = new Set(before.keys());
        const failed = await attempt(world, () =>
            service.add({
                kind,
                zone: zoneIdOf(world, host.zone),
                label: host.label,
                ...(kind === 'dev' ? { port } : {}),
                comeBack: world.focused || next() < 0.5
            })
        );

        targets = new Set(
            rowsOf(world)
                .filter((candidate) => !ids.has(candidate.id))
                .map((candidate) => candidate.id)
        );

        if (kind === 'dev') {
            refusedForPort(failed, port);
        }

        const refusedBy = failed instanceof TunnelConfigError ? failed.code : null;
        const leftBy = refusedBy === 'hostname-on-tunnel' ? !world.writerHosts.has(hostname) : refusedBy === 'other-machine';

        if (leftBy && !world.abandoned.has(hostname)) {
            world.problems.push(`add of ${hostname} refused with ${refusedBy} by what Ruimte left behind`);
        }
    } else if (draw < 11 && row !== undefined) {
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

        const failed = await attempt(world, () => service.update(row.id, update));

        if (row.kind === 'dev') {
            refusedForPort(failed, update.port ?? row.port);
        }
    } else if (draw < 12.5 && row !== undefined) {
        const tunnelId = world.disk.value?.tunnel?.id ?? '';

        world.log.push(`remove ${row.hostname}`);
        targets = new Set([row.id]);

        const failed = await attempt(world, () => service.remove(row.id));
        const left = rowsOf(world).find((candidate) => candidate.id === row.id);

        // A Remove that resolved took the row off whole; one that failed halfway says so on the row.
        if (failed === null && left !== undefined) {
            world.problems.push(`a Remove of ${row.hostname} resolved while its row stays`);
        } else if (failed === null) {
            checkGone(world, tunnelId, [row.hostname]);
        } else if (left?.leaving === true && (await service.state()).rows.find((candidate) => candidate.id === row.id)?.reason === undefined) {
            world.problems.push(`a Remove of ${row.hostname} failed and left its row without a reason`);
        }
    } else if (draw < 13 && world.disk.value?.tunnel != null) {
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
    } else if (draw < 13.6) {
        const enabled = !world.listener.on;

        world.log.push(`mcp ${enabled}`);
        await attempt(world, () => service.setMcp(enabled));
    } else if (draw < 16) {
        world.log.push('retry');
        await attempt(world, () => service.retry());
        await service.idle();
        checkListener(world);
    } else if (draw < 17) {
        world.log.push('network back');
        service.networkBack();
        await service.idle();
        checkListener(world);
    } else if (draw < 18.5) {
        world.log.push('restart');
        restart = true;
        await world.service.stop();

        if (world.runner.running > 0) {
            world.problems.push('a stopped daemon left cloudflared running');
        }

        world.known.clear();
        // The listener ends with the daemon, and the next one starts it again.
        world.listener.on = false;
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
        world.harsh = true;

        if (tunnel !== undefined) {
            writer(tunnel);
        }
    } else if (draw < 22) {
        const port = pick(next, PORTS.slice(0, 3));

        world.denied = world.denied.includes(port) ? world.denied.filter((candidate) => candidate !== port) : [...world.denied, port];
        world.log.push(`deny list ${world.denied.join(' ')}`);
    } else if (draw < 23) {
        const on = rowsOf(world).filter((candidate) => meantOn(candidate) && hasOurRecord(world, candidate.hostname));
        const chosen = on.length === 0 ? undefined : pick(next, on);

        world.log.push(`dashboard deletes the record of ${chosen?.hostname ?? 'nothing'}`);
        world.harsh = true;

        if (chosen !== undefined) {
            const records = world.cloudflare.records;

            records.splice(0, records.length, ...records.filter((record) => !(record.name === chosen.hostname && record.comment === MARKER)));
            world.deletedOutside.add(chosen.hostname);
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
    world.cloudflare.hidden.clear();
    world.vanishIn = null;
    world.turningOn.clear();
    checkIntent(world, before, tunnelBefore, targets, restart);

    if (!world.harsh) {
        checkAvailable(world, healthy);
    }

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
        writerHosts: new Set(),
        abandoned: new Set(),
        vanishIn: null,
        denied: [...DENIED],
        portTaken: false,
        deletedOutside: new Set(),
        harsh: false,
        // Every third seed, so the default run reaches a restart followed by jobs without a bring-up often.
        focused: seed % 3 === 2,
        log: [],
        problems: []
    };
    const world: World = Object.assign(ground, boot(ground));

    await world.service.setToken(FAKE_API_TOKEN);

    for (let i = 0; i < STEPS && world.problems.length === 0; i++) {
        await step(world);
    }

    if (world.problems.length === 0) {
        await rest(world);
    }

    await world.service.stop();

    return world.problems.length === 0 ? [] : [`seed ${seed}: ${[...new Set(world.problems)].join('; ')}\n  after ${world.log.join('\n  ')}`];
}

const only = process.env.RUIMTE_SEED === undefined ? null : Number(process.env.RUIMTE_SEED);
const batches = only === null ? Array.from({ length: Math.ceil(SEQUENCES / BATCH) }, (_, batch) => batch * BATCH) : [only];

describe('TunnelService under seeded steps and faults', () => {
    test.each(batches)('keeps its invariants from seed %i on', async (first) => {
        const failures: string[] = [];

        for (let seed = first; seed < first + (only === null ? BATCH : 1); seed++) {
            failures.push(...(await sequence(seed)));
        }

        expect(failures).toEqual([]);
    });
});
