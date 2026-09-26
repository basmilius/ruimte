import { describe, expect, spyOn, test } from 'bun:test';
import type { Request, ServerFrame } from '@ruimte/agent-contracts/envelope';
import type { FramePort } from '@ruimte/agent-contracts/port';
import { portTransport } from './port-transport';
import { errorCode, isConnectionError } from './transport';

/* The window's end of a port, with what it sent kept for the test and a way to hand it a frame from the host. */
const fakePort = () => {
    const sent: Array<Request | ServerFrame> = [];
    const listeners = new Set<(frame: unknown) => void>();
    const port: FramePort = {
        send: (frame) => {
            sent.push(frame);
        },
        onFrame: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
    const deliver = (frame: unknown): void => {
        for (const listener of [...listeners]) {
            listener(frame);
        }
    };
    return { port, sent, deliver, listening: () => listeners.size };
};

const lastId = (sent: Array<Request | ServerFrame>): string => (sent.at(-1) as Request).id;

describe('portTransport', () => {
    test('sends a request with an id of its own and resolves the answer to that id', async () => {
        const { port, sent, deliver } = fakePort();
        const transport = portTransport(port);
        const first = transport.request('chat.list', {});
        const second = transport.request('usage.limits', {});
        expect(sent.map((frame) => (frame as Request).type)).toEqual(['chat.list', 'usage.limits']);
        const [firstId, secondId] = sent.map((frame) => (frame as Request).id);
        expect(firstId).not.toBe(secondId);
        deliver({ id: secondId, ok: true, result: { providers: [] } });
        deliver({ id: firstId, ok: true, result: { chats: [] } });
        expect(await first).toEqual({ chats: [] });
        expect(await second).toEqual({ providers: [] });
    });

    test('rejects with the code and the message the host refused with', async () => {
        const { port, sent, deliver } = fakePort();
        const transport = portTransport(port);
        const asked = transport.request('chat.kill', { chatId: 'chat-1' });
        deliver({ id: lastId(sent), ok: false, error: { code: 'chat-not-found', message: 'No such chat' } });
        const failure = await asked.catch((e: unknown) => e);
        expect(errorCode(failure)).toBe('chat-not-found');
        expect((failure as Error).message).toBe('No such chat');
    });

    test('refuses an answer that does not match the schema of its request', async () => {
        const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
        const { port, sent, deliver } = fakePort();
        const transport = portTransport(port);
        const asked = transport.request('chat.list', {});
        deliver({ id: lastId(sent), ok: true, result: { chats: 'none' } });
        expect(errorCode(await asked.catch((e: unknown) => e))).toBe('bad-reply');
        warn.mockRestore();
    });

    test('hands a valid event to its handlers and drops one that does not hold up', () => {
        const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
        const { port, deliver } = fakePort();
        const transport = portTransport(port);
        const seen: unknown[] = [];
        const off = transport.on('chat.bookmarks', (payload) => seen.push(payload));
        deliver({ type: 'event', event: 'chat.bookmarks', payload: { chatId: 'chat-1', bookmarks: [] } });
        deliver({ type: 'event', event: 'chat.bookmarks', payload: { chatId: 7 } });
        deliver({ type: 'event', event: 'session.output', payload: {} });
        deliver('not a frame');
        off();
        deliver({ type: 'event', event: 'chat.bookmarks', payload: { chatId: 'chat-2', bookmarks: [] } });
        expect(seen).toEqual([{ chatId: 'chat-1', bookmarks: [] }]);
        expect(warn).toHaveBeenCalledTimes(3);
        warn.mockRestore();
    });

    test('closing fails what still waits as a lost connection and refuses what comes after', async () => {
        const { port, listening } = fakePort();
        const transport = portTransport(port);
        const statuses: string[] = [];
        transport.subscribeStatus((status) => statuses.push(status));
        expect(transport.status).toBe('open');
        const waiting = transport.request('chat.list', {});
        transport.close();
        expect(isConnectionError(await waiting.catch((e: unknown) => e))).toBe(true);
        expect(errorCode(await transport.request('chat.list', {}).catch((e: unknown) => e))).toBe('not-connected');
        expect(transport.status).toBe('closed');
        expect(statuses).toEqual(['closed']);
        expect(listening()).toBe(0);
    });
});
