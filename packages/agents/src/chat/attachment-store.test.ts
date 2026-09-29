import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChatInfo } from '@ruimte/agent-contracts';
import { recordFileName } from '../record-directory.ts';
import { AttachmentStore, extensionFor, migrateInlineAttachments } from './attachment-store.ts';
import { ChatStore } from './chat-store.ts';

let home = '';
let store: AttachmentStore;

const upload = (name: string, mime: string, text = 'hello') => ({ name, mime, data: Buffer.from(text).toString('base64') });

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-attach-'));
    store = new AttachmentStore(home);
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('extensionFor', () => {
    test('the name wins when it carries one', () => {
        expect(extensionFor('report.PDF', 'application/octet-stream')).toBe('pdf');
    });

    test('a name without one falls back to the mime, then to the subtype, then to bin', () => {
        expect(extensionFor('pasted', 'image/png')).toBe('png');
        expect(extensionFor('pasted', 'application/zip')).toBe('zip');
        // A dotted subtype would not be a usable extension, so it falls through to `bin` like an unknown one.
        expect(extensionFor('pasted', 'application/vnd.something+weird')).toBe('bin');
        expect(extensionFor('pasted', '')).toBe('bin');
    });
});

describe('AttachmentStore', () => {
    test('save writes the bytes under the chat and answers what the thread keeps', async () => {
        const saved = await store.save('node-1', upload('notes.md', 'text/markdown', 'a line'));
        expect(saved).toMatchObject({ name: 'notes.md', mime: 'text/markdown', size: 6 });
        expect(basename(saved.path)).toBe(`${saved.id}.md`);
        expect(dirname(saved.path)).toBe(join(home, 'attachments', 'node-1'));
        expect(await readFile(saved.path, 'utf8')).toBe('a line');
    });

    test('a chat id that looks like a path cannot reach outside the folder', async () => {
        const saved = await store.save('../escape', upload('x.txt', 'text/plain'));
        expect(dirname(saved.path)).toBe(join(home, 'attachments', '..%2Fescape'));
    });

    test('removeAll drops everything the chat attached', async () => {
        const saved = await store.save('node-2', upload('x.txt', 'text/plain'));
        await store.removeAll('node-2');
        expect(await Bun.file(saved.path).exists()).toBe(false);
    });
});

describe('migrateInlineAttachments', () => {
    test('an image written inline becomes a file, once, and the record keeps the metadata', async () => {
        const record = {
            info: { chatId: 'old' },
            items: [
                {
                    id: 'user-1',
                    kind: 'user',
                    createdAt: 1,
                    turnId: 't1',
                    text: 'look',
                    attachments: [{ name: 'shot.png', mediaType: 'image/png', data: Buffer.from('png bytes').toString('base64') }]
                }
            ]
        };
        const migrated = (await migrateInlineAttachments('old', record, store)) as { items: Array<{ attachments: Array<Record<string, unknown>> }> };
        const attachment = migrated.items[0]!.attachments[0]!;
        expect(attachment).toMatchObject({ name: 'shot.png', mime: 'image/png', size: 9 });
        expect(await readFile(String(attachment.path), 'utf8')).toBe('png bytes');
        // Nothing inline is left, so a second read has no work to do.
        expect(await migrateInlineAttachments('old', migrated, store)).toBeNull();
    });

    test('a chat store opening a record with an image inline moves it to a file and writes the record back without it', async () => {
        const chats = new ChatStore(home, { attachments: store });
        const info: ChatInfo = {
            chatId: 'old',
            provider: 'claude',
            cwd: '/',
            agentSessionId: null,
            model: null,
            selection: { model: 'claude-sonnet-5', options: {} },
            runtimeMode: 'full-access',
            status: 'idle',
            running: false,
            activeTurnId: null,
            slashCommands: [],
            usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
            createdAt: 0
        };
        const inline = { name: 'shot.png', mediaType: 'image/png', data: Buffer.from('png bytes').toString('base64') };
        const path = join(chats.dir, recordFileName('old'));
        await mkdir(chats.dir, { recursive: true });
        await writeFile(
            path,
            JSON.stringify({ info, items: [{ id: 'user-1', kind: 'user', createdAt: 1, turnId: 't1', text: 'look', attachments: [inline] }] })
        );

        const loaded = await chats.read('old');
        const item = loaded?.items[0];
        const attachment = item?.kind === 'user' ? item.attachments?.[0] : undefined;
        expect(attachment).toMatchObject({ name: 'shot.png', mime: 'image/png', size: 9 });
        expect(await readFile(String(attachment?.path), 'utf8')).toBe('png bytes');
        expect(await readFile(path, 'utf8')).not.toContain(inline.data);
    });

    test('a record without inline attachments is left alone', async () => {
        expect(await migrateInlineAttachments('old', { items: [{ id: 'a', kind: 'assistant' }] }, store)).toBeNull();
        expect(await migrateInlineAttachments('old', null, store)).toBeNull();
    });
});
