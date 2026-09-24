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
 * The fakes run as real child processes here, since the in-process tests cannot show that frames
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

const alive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

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

    test('a crash says what Claude Code wrote on stderr last, read to the end of the pipe', async () => {
        await manager.create({ chatId: 'chat-loud', cwd: home });
        manager.attach('chat-loud', 'c1');
        await manager.send('chat-loud', 'crash loudly');
        await waitFor(crashed, 'the Claude process to exit');
        const note = recorder.ofKind('note').at(-1);
        expect(note?.text.startsWith('Claude Code exited with code 1\n\n```\n')).toBe(true);
        expect(note?.text.endsWith('Error: the fake lost its key\n    at handleUser (fake-claude.ts)\n```')).toBe(true);
    });

    test('a disposed chat takes along what its CLI started, not only the CLI', async () => {
        await manager.create({ chatId: 'chat-tree', cwd: home });
        manager.attach('chat-tree', 'c1');
        await manager.send('chat-tree', 'start a grandchild');
        await waitFor(idle, 'the Claude turn to end');
        const pid = Number(/^grandchild (\d+)$/.exec(recorder.ofKind('assistant')[0]?.text ?? '')?.[1]);
        expect(alive(pid)).toBe(true);
        try {
            await manager.get('chat-tree')!.dispose();
            // Reaped by whoever adopts it, which takes a moment after the signal.
            await waitFor(() => !alive(pid), 'the grandchild to go');
        } finally {
            if (alive(pid)) {
                process.kill(pid, 'SIGKILL');
            }
        }
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
