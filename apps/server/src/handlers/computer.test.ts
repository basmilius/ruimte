import { describe, expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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

    test('a language a client switched to reaches the overlay', async () => {
        const { computer, home } = await computerSetup();
        const dispatcher = new Dispatcher();
        registerComputerHandlers(dispatcher, computer);
        const frames: ServerFrame[] = [];
        const client: ClientConnection = { id: 'client-1', send: (frame) => frames.push(frame) };
        await dispatcher.handle(client, request('computer.setLanguage', { language: 'nl' }));
        expect(frames.at(-1)).toMatchObject({ ok: true, result: {} });
        expect(JSON.parse(await readFile(join(home, 'computer-use', 'overlay.json'), 'utf8')).pause).toBe('Pauzeren');
    });

    test('lists the grants and takes one back', async () => {
        const { computer } = await computerSetup();
        const dispatcher = new Dispatcher();
        registerComputerHandlers(dispatcher, computer);
        const frames: ServerFrame[] = [];
        const client: ClientConnection = { id: 'client-1', send: (frame) => frames.push(frame) };
        expect(await computer.operate('chat-1', 'state', 'Shells', {}).catch(() => 'refused')).toBe('refused');

        await dispatcher.handle(client, request('computer.grants'));
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { always: [], terminals: [{ name: 'Shells' }], thisTime: [] } });

        await dispatcher.handle(client, request('computer.revoke', { bundleId: 'com.example.shells', kind: 'terminal' }));
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { removed: true } });
        await dispatcher.handle(client, request('computer.revoke', { bundleId: 'com.example.shells', kind: 'terminal' }));
        expect(frames.at(-1)).toMatchObject({ ok: true, result: { removed: false } });
        await dispatcher.handle(client, request('computer.revoke', { bundleId: 'com.example.shells', kind: 'forever' }));
        expect(frames.at(-1)).toMatchObject({ ok: false });
    });
});
