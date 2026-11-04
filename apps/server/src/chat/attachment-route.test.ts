import { beforeEach, describe, expect, test } from 'bun:test';
import { AttachmentStore } from '@adecore/agents/chat';
import type { ChatAttachment } from '@ruimte/contracts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { ATTACHMENTS_PATH, handleAttachmentRequest } from './attachment-route.ts';

// What the desktop app on this machine presents; a loopback address alone gets nothing.
const LOCAL_SECRET = 'the-local-secret';
const OPTIONS = { localSecret: LOCAL_SECRET, tickets: { ticketAccess: async () => null } };

let root: string;
let store: AttachmentStore;
let png: ChatAttachment;
let zip: ChatAttachment;

async function lookup(chatId: string, id: string): Promise<ChatAttachment | null> {
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

const newHome = tempHomes('ruimte-attach-route-');

beforeEach(async () => {
    root = await newHome();
    store = new AttachmentStore(root);
    png = await store.save('node-1', { name: 'shot.png', mime: 'image/png', data: Buffer.from('png bytes').toString('base64') });
    zip = await store.save('node-1', { name: 'bundle.zip', mime: 'application/zip', data: Buffer.from('zip bytes').toString('base64') });
});

describe('the attachment route', () => {
    test('serves an image inline to the local secret, under the name it was attached with', async () => {
        const response = await ask('node-1', png.id);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(response.headers.get('content-disposition')).toBe('inline; filename="shot.png"');
        expect(await response.text()).toBe('png bytes');
    });

    test('a name beyond ASCII goes out with a plain stand-in and in the form for the real name, and never breaks the header', async () => {
        const names: Array<[string, string]> = [
            ['häuser-🏠.png', `inline; filename="h_user-_.png"; filename*=UTF-8''h%C3%A4user-%F0%9F%8F%A0.png`],
            ['Home screen (dark)*.png', `inline; filename="Home screen (dark)*.png"`],
            ['a"b\\c.png', `inline; filename="abc.png"`],
            ['a\tb\nc\r.png', `inline; filename="abc.png"`],
            ["it's é.png", `inline; filename="it's _.png"; filename*=UTF-8''it%27s%20%C3%A9.png`],
            ['lone \ud800 surrogate.png', `inline; filename="lone _ surrogate.png"; filename*=UTF-8''lone%20%EF%BF%BD%20surrogate.png`]
        ];
        for (const [name, expected] of names) {
            const attachment = await store.save('node-1', { name, mime: 'image/png', data: Buffer.from('png bytes').toString('base64') });
            const url = new URL(`http://127.0.0.1:4210${ATTACHMENTS_PATH}/node-1/${attachment.id}`);
            const response = await handleAttachmentRequest(new Request(url, asLocal()), url, '127.0.0.1', OPTIONS, async () => attachment);
            expect(response.status, name).toBe(200);
            expect(response.headers.get('content-disposition'), name).toBe(expected);
        }
    });

    test('a file a browser cannot paint is handed over as a download', async () => {
        const response = await ask('node-1', zip.id);
        expect(response.headers.get('content-disposition')).toBe('attachment; filename="bundle.zip"');
    });

    test('a page of HTML is never painted on this origin: it goes out as a download the browser may not sniff', async () => {
        const page = await store.save('node-1', {
            name: 'chart.html',
            mime: 'text/html',
            data: Buffer.from('<script>fetch("/ws")</script>').toString('base64')
        });
        const url = new URL(`http://127.0.0.1:4210${ATTACHMENTS_PATH}/node-1/${page.id}`);
        const response = await handleAttachmentRequest(new Request(url, asLocal()), url, '127.0.0.1', OPTIONS, async (chatId, id) =>
            chatId === 'node-1' && id === page.id ? page : null
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/html');
        expect(response.headers.get('content-disposition')).toBe('attachment; filename="chart.html"');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
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
