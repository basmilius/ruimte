import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatAttachment } from '@ruimte/contracts';
import { ATTACHMENTS_PATH, handleAttachmentRequest } from './attachment-route.ts';
import { AttachmentStore } from '@ruimte/agents/chat/attachment-store';

// What the desktop app on this machine presents; a loopback address alone gets nothing.
const LOCAL_SECRET = 'the-local-secret';
const OPTIONS = { localSecret: LOCAL_SECRET, tickets: { ticketAccess: async () => null } };

let root: string;
let store: AttachmentStore;
let png: ChatAttachment;
let zip: ChatAttachment;

function lookup(chatId: string, id: string): ChatAttachment | null {
    if (chatId !== 'node-1') {
        return null;
    }
    return [png, zip].find((attachment) => attachment.id === id) ?? null;
}

function ask(chatId: string, id: string, remote = '127.0.0.1', init?: RequestInit): Promise<Response> {
    const url = new URL(`http://127.0.0.1:4210${ATTACHMENTS_PATH}/${encodeURIComponent(chatId)}/${id}`);
    return handleAttachmentRequest(new Request(url, asLocal(init)), url, remote, OPTIONS, lookup);
}
// Every request below carries the local secret unless a test says otherwise, the way the desktop app's does.
function asLocal(init?: RequestInit): RequestInit {
    return {
        ...init,
        headers: { authorization: `Bearer ${LOCAL_SECRET}`, ...(init?.headers as Record<string, string>) }
    };
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-attach-route-'));
    store = new AttachmentStore(root);
    png = await store.save('node-1', { name: 'shot.png', mime: 'image/png', data: Buffer.from('png bytes').toString('base64') });
    zip = await store.save('node-1', { name: 'bundle.zip', mime: 'application/zip', data: Buffer.from('zip bytes').toString('base64') });
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('the attachment route', () => {
    test('serves an image inline to the local secret, under the name it was attached with', async () => {
        const response = await ask('node-1', png.id);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(response.headers.get('content-disposition')).toBe('inline; filename="shot.png"');
        expect(await response.text()).toBe('png bytes');
    });

    test('a file a browser cannot paint is handed over as a download', async () => {
        const response = await ask('node-1', zip.id);
        expect(response.headers.get('content-disposition')).toBe('attachment; filename="bundle.zip"');
    });

    test('an id the chat does not know, and a chat nobody attached to, answer 404', async () => {
        expect((await ask('node-1', 'deadbeef')).status).toBe(404);
        expect((await ask('node-2', png.id)).status).toBe(404);
    });

    test('a file the thread names but disk no longer has answers 404', async () => {
        await store.removeAll('node-1');
        expect((await ask('node-1', png.id)).status).toBe(404);
    });

    test('a request without a credential gets nothing, from elsewhere or from a tunnel on this machine', async () => {
        const bare = new URL(`http://127.0.0.1:4210${ATTACHMENTS_PATH}/node-1/${png.id}`);
        expect((await handleAttachmentRequest(new Request(bare), bare, '192.168.1.20', OPTIONS, lookup)).status).toBe(401);
        expect((await handleAttachmentRequest(new Request(bare), bare, '127.0.0.1', OPTIONS, lookup)).status).toBe(401);
    });

    test('answers 404 for a path that names no attachment', async () => {
        const short = new URL(`http://127.0.0.1:4210${ATTACHMENTS_PATH}/node-1`);
        expect((await handleAttachmentRequest(new Request(short, asLocal()), short, '127.0.0.1', OPTIONS, lookup)).status).toBe(404);
    });
});
