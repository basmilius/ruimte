import { describe, expect, test } from 'bun:test';
import { GatedHost, turnOver, type Plan } from './lifecycle-harness.ts';

/*
 * Hundreds of seeded runs of what can happen to extensions at once, each step of the store, the files, the language servers
 * and the processes let go in an order the seed picks. A failure names its seed; `RUIMTE_SEED=<seed>` runs that one alone.
 */
const SEQUENCES = 300;
const BATCH = 30;
const IDS = ['acme.one', 'acme.two'] as const;
const KEYS = ['a', 'b'] as const;
// Turns with nothing to let go and an operation still open, after which a run counts as stuck. No wall clock is read.
const STUCK_TURNS = 50;

const PLANS: Plan[] = [
    {
        manifest: {
            id: 'acme.one',
            autostart: true,
            permissions: { 'languages.servers': 'Adds one', 'agents.tools': 'Offers one', 'chats.read': 'Follows chats' }
        },
        onLoad: (child) => {
            child.say({ type: 'subscribe', name: 'chat.status' });
            child.say({ type: 'tool', name: 'fact', description: 'A fact', parameters: {} });
            child.say({ type: 'ask', id: 1, method: 'languages.add', args: [{ name: 'one', command: 'one', languages: ['one'], patterns: [] }] });
        }
    },
    {
        manifest: { id: 'acme.two', permissions: { 'chats.read': 'Follows chats' } },
        onLoad: (child) => child.say({ type: 'subscribe', name: 'chat.status' })
    }
];

/* mulberry32: small, and the same numbers for the same seed everywhere. */
function random(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;

        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);

        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
    };
}

interface Run {
    gated: GatedHost;
    log: string[];
    open: Set<Promise<unknown>>;
    writes: Map<string, number>;
    problems: string[];
}

function pick<Value>(next: () => number, values: readonly Value[]): Value {
    return values[Math.floor(next() * values.length)] as Value;
}

/* Starts one operation without waiting for it, and keeps it until it settles. */
function launch(run: Run, label: string, operation: () => Promise<unknown>): void {
    const promise = operation().catch(() => undefined);

    run.log.push(label);
    run.open.add(promise);
    void promise.then(() => run.open.delete(promise));
}

function operate(run: Run, next: () => number, step: number, clients: Map<string, () => void>): void {
    const { host } = run.gated;
    const id = pick(next, IDS);
    const kind = pick(next, [
        'call',
        'call',
        'disable',
        'enable',
        'remove',
        'install',
        'restart',
        'stopAll',
        'storage',
        'storage',
        'subscribe',
        'event'
    ] as const);

    if (kind === 'call') {
        launch(run, `call ${id}`, () => host.call(id, 'add', []));
    } else if (kind === 'disable' || kind === 'enable') {
        launch(run, `${kind} ${id}`, () => host.setEnabled(id, kind === 'enable'));
    } else if (kind === 'remove') {
        launch(run, `remove ${id}`, () => host.remove(id));
    } else if (kind === 'install') {
        launch(run, `install ${id}`, () => host.install(id));
    } else if (kind === 'restart') {
        launch(run, `restart ${id}`, () => host.linked(id));
    } else if (kind === 'stopAll') {
        run.log.push('stopAll');
        host.stopAll();
    } else if (kind === 'storage') {
        const key = pick(next, KEYS);

        run.writes.set(`${id}/${key}`, step);
        launch(run, `storage ${id} ${key}=${step}`, () => host.storageSet(id, key, step));
    } else if (kind === 'subscribe') {
        const client = `client-${Math.floor(next() * 2)}`;
        const forget = clients.get(client);

        if (forget === undefined) {
            let forgotten = false;
            const unsubscribe = host.subscribe(client, (event) => {
                if (forgotten) {
                    run.problems.push(`${client} heard ${event.event} after it was forgotten`);
                }
            });

            run.log.push(`subscribe ${client}`);
            clients.set(client, () => {
                forgotten = true;
                unsubscribe();
            });
        } else {
            run.log.push(`forget ${client}`);
            forget();
            clients.delete(client);
        }
    } else {
        run.log.push('event chat.status');
        host.forwardEvent('chat.status', { chatId: 'chat-1', info: { chatId: 'chat-1', provider: 'claude', status: 'idle', model: null, cwd: '/work' } });
    }
}

/* Lets go of held steps in the seed's order until every operation settled. */
async function settle(run: Run, next: () => number): Promise<void> {
    const { gates } = run.gated;

    for (let idle = 0; run.open.size > 0 || gates.held.length > 0;) {
        if (gates.held.length > 0) {
            pick(next, gates.held).release();
            idle = 0;
        } else if (++idle > STUCK_TURNS) {
            run.problems.push(`stuck with ${run.open.size} operations open`);

            return;
        }

        await turnOver();
    }
}

function check(run: Run): void {
    const { gated, problems } = run;

    problems.push(...gated.overlaps.map((id) => `two processes of ${id} at once`));

    for (const child of gated.children) {
        problems.push(...child.toldAfterKill.map((line) => `a stopped process of ${child.id} was told ${line}`));

        if (child.killed && !child.exited) {
            problems.push(`a stopped process of ${child.id} never exited`);
        }
    }

    for (const id of IDS) {
        const off = !gated.has(id) || !gated.enabled(id);

        if (gated.live(id).length > 1) {
            problems.push(`${gated.live(id).length} processes of ${id}`);
        }

        if (off && gated.live(id).length > 0) {
            problems.push(`a process of ${id} runs while it is ${gated.has(id) ? 'off' : 'removed'}`);
        }

        if (off && (gated.languageServers.get(id)?.size ?? 0) > 0) {
            problems.push(`a language server of ${id} stayed while it is ${gated.has(id) ? 'off' : 'removed'}`);
        }

        if (off && gated.host.agentTools().some((tool) => tool.id.startsWith(`${id}/`))) {
            problems.push(`a tool of ${id} is listed while it is ${gated.has(id) ? 'off' : 'removed'}`);
        }
    }

    for (const [path, value] of run.writes) {
        const [id, key] = path.split('/') as [string, string];
        const stored = JSON.parse(gated.files.get(`/extensions/${id}/data/storage.json`) ?? '{}') as Record<string, unknown>;

        if (stored[key] !== value) {
            problems.push(`storage ${path} holds ${String(stored[key])}, not the last write ${value}`);
        }
    }
}

async function sequence(seed: number): Promise<string[]> {
    const next = random(seed);
    const run: Run = { gated: new GatedHost(PLANS), log: [], open: new Set(), writes: new Map(), problems: [] };
    const clients = new Map<string, () => void>();
    const operations = 8 + Math.floor(next() * 16);

    launch(run, 'startAutostarted', () => run.gated.host.startAutostarted());

    for (let step = 0; step < operations;) {
        if (run.gated.gates.held.length === 0 || next() < 0.35) {
            operate(run, next, step, clients);
            step += 1;
        } else {
            pick(next, run.gated.gates.held).release();
        }

        await turnOver();
    }

    await settle(run, next);
    check(run);
    run.gated.host.stopAll();

    return run.problems.length === 0 ? [] : [`seed ${seed}: ${run.problems.join('; ')}\n  after ${run.log.join(', ')}`];
}

const only = process.env.RUIMTE_SEED === undefined ? null : Number(process.env.RUIMTE_SEED);
const batches = only === null ? Array.from({ length: SEQUENCES / BATCH }, (_, batch) => batch * BATCH) : [only];

describe('ExtensionHost under seeded interleavings', () => {
    test.each(batches)('keeps its invariants from seed %i on', async (first) => {
        const failures: string[] = [];

        for (let seed = first; seed < first + (only === null ? BATCH : 1); seed++) {
            failures.push(...(await sequence(seed)));
        }

        expect(failures).toEqual([]);
    });
});
