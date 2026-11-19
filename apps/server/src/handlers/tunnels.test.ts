import { expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { runStop, type Area } from '../area.ts';
import { Dispatcher } from '../dispatcher.ts';
import type { ClientConnection } from '../wire.ts';
import { tunnelsArea } from './tunnels.ts';

type TunnelsDeps = Parameters<typeof tunnelsArea>[0];

test('a client the machine let in confirms a card, and changes a tunnel no other way', async () => {
    const confirmed: string[] = [];
    const added: unknown[] = [];
    const dispatcher = new Dispatcher();
    tunnelsArea({
        service: { add: async (payload: unknown) => void added.push(payload) } as unknown as TunnelsDeps['service'],
        proposals: { list: () => [], confirm: async (id) => (confirmed.push(id), true), decline: () => true },
        credentials: {} as TunnelsDeps['credentials'],
        consent: {} as TunnelsDeps['consent'],
        listener: { stop: () => undefined },
        changes: { subscribe: () => () => undefined },
        changed: () => undefined
    }).handlers?.(dispatcher);
    const frames: ServerFrame[] = [];
    const phone: ClientConnection = { id: 'phone', access: { reachability: 'tunnel', sessionId: 'session-1' }, send: (frame) => void frames.push(frame) };

    await dispatcher.handle(phone, JSON.stringify({ id: 'r1', type: 'tunnel.proposalConfirm', payload: { proposalId: 'p1' } }));
    await dispatcher.handle(phone, JSON.stringify({ id: 'r2', type: 'tunnel.add', payload: { kind: 'dev', zone: 'zone-1', label: 'app', port: 5173 } }));

    expect(frames[0]).toEqual({ id: 'r1', ok: true, result: { accepted: true } });
    expect(frames[1]).toMatchObject({ id: 'r2', ok: false, error: { code: 'forbidden' } });
    expect(confirmed).toEqual(['p1']);
    expect(added).toEqual([]);
});

test('stopping the tunnels waits until the chats, tasks and terminals have drained', async () => {
    const ran: string[] = [];
    const tunnels = tunnelsArea({
        service: { stop: async () => void ran.push('tunnels') } as unknown as TunnelsDeps['service'],
        proposals: {} as TunnelsDeps['proposals'],
        credentials: {} as TunnelsDeps['credentials'],
        consent: {} as TunnelsDeps['consent'],
        listener: { stop: () => void ran.push('listener') },
        changes: { subscribe: () => () => undefined },
        changed: () => undefined
    });
    const chats: Area = { name: 'chat', stop: [{ phase: 'drain', label: 'Writing chats', run: () => void ran.push('chats') }] };

    await runStop([tunnels, chats], () => undefined);

    expect(ran).toEqual(['chats', 'tunnels', 'listener']);
});
