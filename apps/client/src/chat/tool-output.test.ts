import { describe, expect, test } from 'bun:test';
import type { RequestType } from '@ruimte/contracts';
import type { ConnectionState } from '@/transport-api/transport';
import { readToolOutput } from './tool-output';

function machine(features: RequestType[]) {
    const asked: unknown[] = [];
    const transport = {
        connection: { features } as unknown as ConnectionState,
        request: async (type: RequestType, payload: unknown) => {
            asked.push({ type, payload });
            return { output: 'the whole output' };
        }
    };

    return { asked, transport: transport as unknown as Parameters<typeof readToolOutput>[0] };
}

describe('the whole output of a tool call', () => {
    test('is asked of a machine that answers it', async () => {
        const { asked, transport } = machine(['chat.attach', 'chat.toolOutput']);

        expect(await readToolOutput(transport, 'chat-1', 'tool-1')).toBe('the whole output');
        expect(asked).toEqual([{ type: 'chat.toolOutput', payload: { chatId: 'chat-1', itemId: 'tool-1' } }]);
    });

    test('is never asked of an older machine, which keeps the beginning on screen', async () => {
        const { asked, transport } = machine(['chat.attach']);

        await expect(readToolOutput(transport, 'chat-1', 'tool-1')).rejects.toThrow(
            "This chat's machine runs an older Ruimte and cannot show the full output."
        );
        expect(asked).toEqual([]);
    });

    test('says the machine is not connected without a link', async () => {
        await expect(readToolOutput(null, 'chat-1', 'tool-1')).rejects.toThrow("This chat's machine is not connected.");
    });
});
