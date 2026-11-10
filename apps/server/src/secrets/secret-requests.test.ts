import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { SecretRequest } from '@ruimte/contracts';
import { ManualTimers } from '../computer/computer-test-helpers.ts';
import { NodeLifecycle } from '../node-lifecycle.ts';
import type { SessionEvent } from '../wire.ts';
import { SECRET_CARD_MS, SECRET_WAIT_MS, type SecretAsk } from './secret-requests.ts';
import { SecretService } from './secret-service.ts';
import type { SecretSlot } from './secret-store.ts';

const VALUE = 'sk-live-0123456789abcdef';

class MemoryStore {
    readonly values = new Map<string, string>();
    failWrite = false;
    private keyOf(projectId: string, slot: SecretSlot): string {
        return `${projectId}/${slot.launchId}/${slot.variable}`;
    }
    async has(projectId: string, slot: SecretSlot): Promise<boolean> {
        return this.values.has(this.keyOf(projectId, slot));
    }
    async write(projectId: string, slot: SecretSlot, value: string): Promise<void> {
        if (this.failWrite) {
            throw new Error('disk full');
        }
        this.values.set(this.keyOf(projectId, slot), value);
    }
    async remove(projectId: string, slot: SecretSlot): Promise<void> {
        this.values.delete(this.keyOf(projectId, slot));
    }
}

const ask: SecretAsk = {
    nodeId: 'chat-1',
    projectId: 'p1',
    launchId: 'api',
    launchName: 'API',
    variable: 'API_KEY',
    label: 'The Stripe test key',
    reason: 'The API calls Stripe on checkout'
};

let timers: ManualTimers;
let store: MemoryStore;
let bound: string[];
let bindFails: boolean;
let holds: Map<string, Set<string>>;
let published: SecretRequest[][];
let events: SessionEvent[];
let service: SecretService;
let lifecycle: NodeLifecycle;

function heldKeys(nodeId: string): string[] {
    return [...(holds.get(nodeId) ?? [])];
}

async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

beforeEach(() => {
    timers = new ManualTimers();
    store = new MemoryStore();
    bound = [];
    bindFails = false;
    holds = new Map();
    published = [];
    events = [];
    service = new SecretService({
        store,
        launches: {
            bindSecret: async (projectId, launchId, variable) => {
                if (bindFails) {
                    throw new Error('launch-not-found');
                }
                bound.push(`${projectId}/${launchId}/${variable}`);
            }
        },
        chats: {
            hold: (nodeId, key) => holds.set(nodeId, new Set([...(holds.get(nodeId) ?? []), key])),
            release: (nodeId, key) => holds.get(nodeId)?.delete(key)
        },
        now: () => timers.now,
        timers
    });
    lifecycle = new NodeLifecycle();
    service.follow(lifecycle);
    service.subscribe('client', (event) => {
        events.push(event);
        if (event.event === 'secret.requests') {
            published.push(event.payload.requests);
        }
    });
});

describe('a secret card', () => {
    test('a save stores the value, binds the variable and answers saved, with the value nowhere else', async () => {
        const waiting = service.ask(ask, 30_000);
        await flush();
        const [card] = service.list();
        expect(card).toMatchObject({ nodeId: 'chat-1', launchId: 'api', launchName: 'API', variable: 'API_KEY', replaces: false });
        expect(heldKeys('chat-1')).toHaveLength(1);

        expect(await service.save(card!.requestId, VALUE)).toBe(true);
        expect(await waiting).toEqual({ requestId: card!.requestId, outcome: 'saved' });
        expect(store.values.get('p1/api/API_KEY')).toBe(VALUE);
        expect(bound).toEqual(['p1/api/API_KEY']);
        expect(service.list()).toEqual([]);
        expect(heldKeys('chat-1')).toEqual([]);
        expect(JSON.stringify(events)).not.toContain(VALUE);
        // A second client that answers late hears it lost.
        expect(await service.save(card!.requestId, 'other')).toBe(false);
        expect(service.decline(card!.requestId)).toBe(false);
    });

    test('a decline answers declined and stores nothing', async () => {
        const waiting = service.ask(ask, 30_000);
        await flush();
        expect(service.decline(service.list()[0]!.requestId)).toBe(true);
        expect((await waiting).outcome).toBe('declined');
        expect(store.values.size).toBe(0);
        expect(heldKeys('chat-1')).toEqual([]);
    });

    test('the hold runs out with waiting, asking again joins the same card, and a later answer is told once', async () => {
        const first = service.ask(ask);
        await flush();
        timers.advance(SECRET_WAIT_MS);
        const { requestId, outcome } = await first;
        expect(outcome).toBe('waiting');
        expect(service.list()).toHaveLength(1);

        const second = service.ask({ ...ask, label: 'The Stripe key' });
        await flush();
        expect(service.list()).toHaveLength(1);
        expect(service.list()[0]).toMatchObject({ requestId, label: 'The Stripe key' });
        timers.advance(SECRET_WAIT_MS);
        expect(await second).toEqual({ requestId, outcome: 'waiting' });

        expect(service.decline(requestId)).toBe(true);
        expect(await service.ask(ask)).toEqual({ requestId, outcome: 'declined' });
        // Told once: the next ask raises a new card.
        const next = service.ask(ask, 1_000);
        await flush();
        expect(service.list()[0]?.requestId).not.toBe(requestId);
        timers.advance(1_000);
        await next;
    });

    test('a card nobody answers times out', async () => {
        const waiting = service.ask(ask, 110_000);
        await flush();
        timers.advance(110_000);
        expect((await waiting).outcome).toBe('waiting');
        timers.advance(SECRET_CARD_MS);
        expect(service.list()).toEqual([]);
        expect(heldKeys('chat-1')).toEqual([]);
        expect((await service.ask(ask)).outcome).toBe('timed-out');
    });

    test('a turn that ends cancels the card, and so does a chat that stops or goes', async () => {
        const waiting = service.ask(ask, 30_000);
        await flush();
        await lifecycle.emit('turnEnded', 'chat-1', 'done');
        expect((await waiting).outcome).toBe('cancelled');
        expect(service.list()).toEqual([]);
        expect(heldKeys('chat-1')).toEqual([]);

        const again = service.ask(ask, 30_000);
        await flush();
        await lifecycle.emit('closed', 'chat-1');
        expect((await again).outcome).toBe('cancelled');
    });

    test('a failed save keeps the card and leaves no value behind', async () => {
        const waiting = service.ask(ask, 30_000);
        await flush();
        const { requestId } = service.list()[0]!;
        bindFails = true;
        await expect(service.save(requestId, VALUE)).rejects.toThrow('launch-not-found');
        expect(store.values.size).toBe(0);
        expect(service.list()).toHaveLength(1);
        bindFails = false;
        expect(await service.save(requestId, VALUE)).toBe(true);
        expect((await waiting).outcome).toBe('saved');
    });

    test('the value reaches no log, no chat hold and no event, also when a save fails', async () => {
        const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => spyOn(console, level).mockImplementation(() => undefined));
        const touched: string[] = [];
        try {
            const waiting = service.ask(ask, 30_000);
            await flush();
            const { requestId } = service.list()[0]!;
            bindFails = true;
            await service.save(requestId, VALUE).catch((e: unknown) => touched.push(String(e)));
            bindFails = false;
            await service.save(requestId, VALUE);
            touched.push(JSON.stringify(await waiting), JSON.stringify(events), JSON.stringify([...holds]));
            for (const spy of spies) {
                touched.push(JSON.stringify(spy.mock.calls));
            }
        } finally {
            for (const spy of spies) {
                spy.mockRestore();
            }
        }
        expect(touched.join('\n')).not.toContain(VALUE);
    });

    test('a card says when it replaces a value the launch has', async () => {
        await store.write('p1', { launchId: 'api', variable: 'API_KEY' }, 'old');
        const waiting = service.ask(ask, 1_000);
        await flush();
        expect(service.list()[0]?.replaces).toBe(true);
        expect(published.at(-1)?.[0]?.replaces).toBe(true);
        timers.advance(1_000);
        await waiting;
    });

    test('each chat, launch and variable has a card of its own', async () => {
        const one = service.ask(ask, 1_000);
        const two = service.ask({ ...ask, variable: 'OTHER' }, 1_000);
        const three = service.ask({ ...ask, nodeId: 'chat-2' }, 1_000);
        const four = service.ask({ ...ask, launchId: 'worker', launchName: 'Worker' }, 1_000);
        await flush();
        const cards = service.list();
        expect(cards.map(({ nodeId, launchId, variable }) => [nodeId, launchId, variable])).toEqual([
            ['chat-1', 'api', 'API_KEY'],
            ['chat-1', 'api', 'OTHER'],
            ['chat-2', 'api', 'API_KEY'],
            ['chat-1', 'worker', 'API_KEY']
        ]);
        expect(new Set(cards.map((card) => card.requestId)).size).toBe(4);
        for (const card of cards) {
            expect(service.decline(card.requestId)).toBe(true);
        }
        const outcomes = await Promise.all([one, two, three, four]);
        expect([...outcomes]).toEqual(cards.map(({ requestId }) => ({ requestId, outcome: 'declined' })));
        expect(service.list()).toEqual([]);
    });
});
