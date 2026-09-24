import { describe, expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { computerSetup } from '../computer/computer-test-helpers.ts';
import { Dispatcher, type ClientConnection } from '../dispatcher.ts';
import { registerComputerHandlers } from './computer.ts';

const request = (type: string, payload: unknown = {}): string => JSON.stringify({ id: type, type, payload });

describe('computer handlers', () => {
    test('a press and a restart answer with the status after them', async () => {
        const { computer, helper } = await computerSetup();
        const dispatcher = new Dispatcher();
        registerComputerHandlers(dispatcher, computer);
        const frames: ServerFrame[] = [];
        const client: ClientConnection = { id: 'client-1', send: (frame) => frames.push(frame) };

        await dispatcher.handle(client, request('computer.control', { action: 'pause' }));
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { enabled: true, session: null } });
        expect(helper.requests.at(-1)?.command).toBe('pause');

        await dispatcher.handle(client, request('computer.control', { action: 'hold' }));
        expect(frames.at(-1)).toMatchObject({ ok: false });

        await dispatcher.handle(client, request('computer.restart'));
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { enabled: true, running: true, screenRecording: true } });
    });
});
