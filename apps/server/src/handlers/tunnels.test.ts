import { expect, test } from 'bun:test';
import { runStop, type Area } from '../area.ts';
import { tunnelsArea } from './tunnels.ts';

type TunnelsDeps = Parameters<typeof tunnelsArea>[0];

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
