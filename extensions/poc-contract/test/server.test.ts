import { describe, expect, test } from 'bun:test';
import { createTestServer } from '@ruimte/extension/testing';
import { serverContract } from '../contract/server';
import type { ContractServer } from '../server';

serverContract(async (permissions) => {
    const server = await createTestServer<ContractServer>({
        manifest: { permissions },
        answers: {
            'chats.send': () => undefined,
            'machine.run': { 'launch.start': ({ launch }) => ({ id: launch, name: launch }) }
        }
    });

    return {
        call: (method, ...args) => server.call(method as never, ...(args as [never])),
        fire: (name, payload) => server.fire(name as 'chat.event', payload as { chatId: string }),
        tool: (id, input, caller) => server.tool(id).run(input, { caller }),
        logs: async () => server.logs,
        emitted: async () => server.emitted
    };
});

describe('a test server', () => {
    test('loads the files of server/ afresh, so one keeps nothing another heard', async () => {
        const first = await createTestServer<ContractServer>();

        first.fire('chat.event', { chatId: 'chat-1' });

        expect(await first.call('heard')).toEqual({ ok: true, value: ['chat-1'] });
        expect(await (await createTestServer<ContractServer>()).call('heard')).toEqual({ ok: true, value: [] });
    });
});
