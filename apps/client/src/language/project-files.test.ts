import { describe, expect, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import type { Transport } from '@/transport/transport';
import { draftFiles } from './project-files';

type Call = { type: RequestType; payload: unknown };

/* A transport that records every request and answers it with nothing, or refuses it with `refusal`. */
function fakeTransport(refusal?: string): { transport: Transport; calls: Call[] } {
    const calls: Call[] = [];
    const transport: Transport = {
        status: 'open',
        request: <T extends RequestType>(type: T, payload: RequestMap[T]['payload']) => {
            calls.push({ type, payload });
            return refusal === undefined ? Promise.resolve({} as RequestMap[T]['result']) : Promise.reject(new Error(refusal));
        },
        on:
            <E extends EventType>(_event: E, _handler: (payload: EventMap[E]) => void) =>
            () =>
                undefined,
        subscribeStatus: () => () => undefined
    };
    return { transport, calls };
}

describe('the files a workspace edit creates', () => {
    test('are made through the machine with their text', async () => {
        const { transport, calls } = fakeTransport();
        expect(await draftFiles('local', transport, 'p1').create!('/work/src/UserInterface.php', '<?php\n')).toBeNull();
        expect(calls).toEqual([{ type: 'fs.create', payload: { path: '/work/src/UserInterface.php', kind: 'file', text: '<?php\n' } }]);
    });

    test('say why the machine did not make them', async () => {
        const { transport } = fakeTransport('That path is already there');
        expect(await draftFiles('local', transport, 'p1').create!('/work/src/User.php', '')).toBe('That path is already there');
    });
});
