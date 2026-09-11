import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatAttachment } from '@ruimte/contracts';
import { AuthStore } from '../auth/auth-store.ts';
import { ATTACHMENTS_PATH, handleAttachmentRequest } from './attachment-route.ts';
import { AttachmentStore } from './attachment-store.ts';

// No handshake in these tests, so a credential is only ever a session token.
const OPTIONS = { allowedOrigins: [], requireToken: false, tickets: { ticketSession: () => null } };

let root: string;
let auth: AuthStore;
let store: AttachmentStore;
let png: ChatAttachment;
let zip: ChatAttachment;

const lookup = (chatId: string, id: string): ChatAttachment | null => {
    if (chatId !== 'node-1') {
        return null;
    }
    return [png, zip].find((attachment) => attachment.id === id) ?? null;
};

const ask = (chatId: string, id: string, remote = '127.0.0.1', init?: RequestInit): Promise<Response> => {
    const url = new URL(`http://127.0.0.1:4210${ATTACHMENTS_PATH}/${encodeURIComponent(chatId)}/${id}`);
    return handleAttachmentRequest(new Request(url, init), url, remote, auth, OPTIONS, lookup);
};

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-attach-route-'));
    auth = new AuthStore(join(root, 'home'));
    store = new AttachmentStore(root);
    png = await store.save('node-1', { name: 'shot.png', mime: 'image/png', data: Buffer.from('png bytes').toString('base64') });
    zip = await store.save('node-1', { name: 'bundle.zip', mime: 'application/zip', data: Buffer.from('zip bytes').toString('base64') });
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('the attachment route', () => {
    test('serves an image inline to a loopback client, with headers that keep it inert', async () => {
        const response = await ask('node-1', png.id);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('cache-control')).toContain('immutable');
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

    test('a client from elsewhere needs the token the socket needs', async () => {
        expect((await ask('node-1', png.id, '192.168.1.20')).status).toBe(401);

        const paired = await auth.pair(auth.issuePairingToken(), { label: 'a laptop' });
        const url = new URL(`http://127.0.0.1:4210${ATTACHMENTS_PATH}/node-1/${png.id}?token=${paired!.sessionToken!}`);
        const allowed = await handleAttachmentRequest(new Request(url), url, '192.168.1.20', auth, OPTIONS, lookup);
        expect(allowed.status).toBe(200);
    });

    test('a page on another origin is refused before the file is even looked at', async () => {
        expect((await ask('node-1', png.id, '127.0.0.1', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    });

    test('answers 405 for another method and 404 for a path that names no attachment', async () => {
        expect((await ask('node-1', png.id, '127.0.0.1', { method: 'DELETE' })).status).toBe(405);

        const short = new URL(`http://127.0.0.1:4210${ATTACHMENTS_PATH}/node-1`);
        expect((await handleAttachmentRequest(new Request(short), short, '127.0.0.1', auth, OPTIONS, lookup)).status).toBe(404);
    });
});
