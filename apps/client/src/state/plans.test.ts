import { beforeEach, describe, expect, test } from 'bun:test';
import type { EventMap, EventType, Plan, PlanOfChat, RequestMap, RequestType } from '@ruimte/contracts';
import { PlanClient, type PlanWriteSink } from '@/plan/plan-client';
import { findPlan, PlanSync, plansOf, subscribePlanCreated, usePlans } from '@/state/plans';
import { TransportError, type Transport, type TransportStatus } from '@/transport/transport';

const planOf = (id: string, createdAt: string, rev = 1): Plan => ({
    id,
    rev,
    createdAt,
    meta: { title: id, kind: 'steps', checks: 'anyone' },
    items: [
        { type: 'step', id: 'one', title: 'One' },
        { type: 'step', id: 'locked', title: 'Locked', checks: 'agent' }
    ]
});

class FakeTransport implements Transport {
    status: TransportStatus = 'closed';
    listed: PlanOfChat[] = [];
    applied: RequestMap['plan.apply']['payload'][] = [];
    refuseApply = false;
    private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        if (type === 'plan.list') {
            return Promise.resolve({ plans: this.listed } as RequestMap[T]['result']);
        }
        if (type === 'plan.apply') {
            this.applied.push(payload as RequestMap['plan.apply']['payload']);
            if (this.refuseApply) {
                return Promise.reject(new TransportError('step-locked', 'Only the agent checks "one"'));
            }
            const stored = this.listed[0]!.plan;
            return Promise.resolve({ plan: { ...stored, rev: stored.rev + 1 } } as RequestMap[T]['result']);
        }
        return Promise.reject(new Error(`unexpected ${type}`));
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        const set = this.handlers.get(event) ?? new Set();
        this.handlers.set(event, set);
        set.add(handler as (payload: unknown) => void);
        return () => set.delete(handler as (payload: unknown) => void);
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.statusHandlers.add(handler);
        return () => this.statusHandlers.delete(handler);
    }

    open(): void {
        this.status = 'open';
        for (const handler of this.statusHandlers) {
            handler('open');
        }
    }

    emit<E extends EventType>(event: E, payload: EventMap[E]): void {
        for (const handler of this.handlers.get(event) ?? []) {
            handler(payload);
        }
    }
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

let transport: FakeTransport;

beforeEach(() => {
    usePlans.setState({ byChat: {}, loaded: {}, unseen: {} });
    transport = new FakeTransport();
});

describe('the plans of a machine', () => {
    test('asked for when the socket opens, newest first, and not known before that', async () => {
        transport.listed = [
            { chatId: 'chat-a', plan: planOf('older', '2026-09-16T10:00:00Z') },
            { chatId: 'chat-a', plan: planOf('newer', '2026-09-16T11:00:00Z') }
        ];
        const sync = new PlanSync('local', transport);
        expect(findPlan('local', 'chat-a', 'gone')).toBeUndefined();
        transport.open();
        await settle();
        expect(plansOf('local', 'chat-a').map((plan) => plan.id)).toEqual(['newer', 'older']);
        expect(findPlan('local', 'chat-a', 'gone')).toBeNull();
        sync.dispose();
        expect(plansOf('local', 'chat-a')).toEqual([]);
    });

    test('follows changes and removals, and never takes an older rev over a newer one', () => {
        const sync = new PlanSync('local', transport);
        transport.emit('plan.changed', { chatId: 'chat-a', plan: planOf('p', '2026-09-16T10:00:00Z', 4) });
        transport.emit('plan.changed', { chatId: 'chat-a', plan: planOf('p', '2026-09-16T10:00:00Z', 3) });
        expect(plansOf('local', 'chat-a')[0]?.rev).toBe(4);
        transport.emit('plan.removed', { chatId: 'chat-a', planId: 'p' });
        expect(plansOf('local', 'chat-a')).toEqual([]);
        sync.dispose();
    });

    test('tells who listens about a new plan, which a change does not', () => {
        const sync = new PlanSync('local', transport);
        const heard: string[] = [];
        const off = subscribePlanCreated((endpointId, chatId, planId) => heard.push(`${endpointId}:${chatId}:${planId}`));
        transport.emit('plan.changed', { chatId: 'chat-a', plan: planOf('p', '2026-09-16T10:00:00Z') });
        transport.emit('plan.created', { chatId: 'chat-a', planId: 'p' });
        expect(heard).toEqual(['local:chat-a:p']);
        off();
        sync.dispose();
    });

    test('a dot for an unseen plan goes with the plan', () => {
        usePlans.getState().putPlan('local', 'chat-a', planOf('p', '2026-09-16T10:00:00Z'));
        usePlans.getState().markUnseen('local', 'chat-a', 'p');
        usePlans.getState().removePlan('local', 'chat-a', 'p');
        expect(usePlans.getState().unseen).toEqual({});
    });
});

describe('a person changing a plan', () => {
    const sink: PlanWriteSink = {
        current: (endpointId, chatId, planId) => plansOf(endpointId, chatId).find((plan) => plan.id === planId),
        put: (endpointId, chatId, plan) => usePlans.getState().putPlan(endpointId, chatId, plan)
    };

    beforeEach(() => {
        transport.status = 'open';
        transport.listed = [{ chatId: 'chat-a', plan: planOf('p', '2026-09-16T10:00:00Z') }];
        usePlans.getState().setMachinePlans('local', transport.listed);
    });

    test('the tick shows at once and the answer takes its place', async () => {
        const client = new PlanClient(
            () => transport,
            sink,
            () => '2026-09-16T12:00:00Z'
        );
        const done = client.apply('local', 'chat-a', 'p', [{ op: 'set', ids: ['one'], state: 'done' }]);
        const shown = plansOf('local', 'chat-a')[0]!;
        expect(shown.items[0]).toMatchObject({ state: 'done', by: 'person', at: '2026-09-16T12:00:00Z' });
        expect((await done).id).toBe('p');
        expect(transport.applied).toEqual([{ chatId: 'chat-a', planId: 'p', ops: [{ op: 'set', ids: ['one'], state: 'done' }] }]);
    });

    test('a step only the agent checks is refused here, without asking the machine', async () => {
        const client = new PlanClient(() => transport, sink);
        await expect(client.apply('local', 'chat-a', 'p', [{ op: 'set', ids: ['locked'], state: 'done' }])).rejects.toMatchObject({ code: 'step-locked' });
        expect(transport.applied).toEqual([]);
    });

    test('a refusal from the machine puts the plan back', async () => {
        transport.refuseApply = true;
        const client = new PlanClient(() => transport, sink);
        await expect(client.apply('local', 'chat-a', 'p', [{ op: 'set', ids: ['one'], state: 'done' }])).rejects.toThrow('Only the agent checks "one"');
        expect(plansOf('local', 'chat-a')[0]!.items[0]).not.toHaveProperty('state');
    });
});
