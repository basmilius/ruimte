import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderRegistry } from '../providers/registry.ts';
import { waitFor } from '../sessions/test-helpers.ts';
import { AttachmentStore } from './attachment-store.ts';
import { ChatManager } from './chat-manager.ts';
import { ChatRecorder } from './chat-test-helpers.ts';

/*
 * The fakes as real child processes: what the in-process tests cannot show is that the frames
 * survive a pipe, split and joined on newlines, and that a crash comes back as the exit code.
 */

const FAKE_CLAUDE = ['bun', join(import.meta.dir, 'fake-claude.ts')];
const FAKE_CODEX = ['bun', join(import.meta.dir, 'fake-codex.ts')];

const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });

let home: string;
let manager: ChatManager;
let recorder: ChatRecorder;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-chat-integration-'));
    manager = new ChatManager({
        providers,
        attachments: new AttachmentStore(home),
        command: FAKE_CLAUDE,
        codexCommand: FAKE_CODEX,
        env: { PATH: process.env.PATH, HOME: home }
    });
    recorder = new ChatRecorder();
    manager.subscribe('c1', recorder.sink());
});

afterEach(async () => {
    await manager.shutdown();
    for (const info of manager.list()) {
        manager.get(info.chatId)?.dispose();
    }
    await rm(home, { recursive: true, force: true });
});

const idle = () => recorder.info?.status === 'idle' && recorder.info.running && recorder.info.activeTurnId === null;

const crashed = () => recorder.info?.running === false && recorder.info.status === 'error';

describe('ChatManager over real processes', () => {
    test('Claude Code answers over its pipes and a crash reports the exit code', async () => {
        await manager.create({ chatId: 'chat-claude', cwd: home });
        manager.attach('chat-claude', 'c1');
        await manager.send('chat-claude', 'hello there');
        await waitFor(idle, 'the Claude turn to end');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: hello there']);
        expect(manager.get('chat-claude')?.pid).toBeGreaterThan(0);

        await manager.send('chat-claude', 'crash');
        await waitFor(crashed, 'the Claude process to exit');
        expect(recorder.ofKind('note').at(-1)).toMatchObject({ level: 'error', text: 'Claude Code exited with code 1' });
    });

    test('Codex answers over its pipes and a crash reports the exit code', async () => {
        await manager.create({ chatId: 'chat-codex', provider: 'codex', cwd: home });
        manager.attach('chat-codex', 'c1');
        await manager.send('chat-codex', 'hello there');
        await waitFor(idle, 'the Codex turn to end');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: hello there (medium)']);
        expect(manager.get('chat-codex')?.pid).toBeGreaterThan(0);

        await manager.send('chat-codex', 'crash');
        await waitFor(crashed, 'the Codex process to exit');
        expect(recorder.ofKind('note').at(-1)).toMatchObject({ level: 'error', text: 'Codex exited with code 1' });
    });
});
