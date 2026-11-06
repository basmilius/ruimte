import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AttachmentStore } from '@adecore/agents/chat';
import { killQuietly, processAlive } from '../process-test-helpers.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { OPEN_BOUNDS } from '../sessions/open-bounds-test-helpers.ts';
import { waitFor } from '../sessions/test-helpers.ts';
import { retire } from './chat-manager.fixture.test.ts';
import { ChatManager } from './chat-manager.ts';
import { ChatRecorder } from './chat-test-helpers.ts';

/*
 * The fakes run as real child processes here, since the in-process tests cannot show that frames
 * survive a pipe, split and joined on newlines, and that a crash comes back as the exit code.
 */

const FAKE_CLAUDE = ['bun', fileURLToPath(import.meta.resolve('@adecore/agents/testing/bin/fake-claude'))];
const FAKE_CODEX = ['bun', fileURLToPath(import.meta.resolve('@adecore/agents/testing/bin/fake-codex'))];

const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });

let home: string;
let manager: ChatManager;
let recorder: ChatRecorder;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-chat-integration-'));
    manager = new ChatManager({
        ...OPEN_BOUNDS,
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
    await retire(manager);
    await rm(home, { recursive: true, force: true });
});

async function open(chatId: string, request: Partial<Parameters<ChatManager['create']>[0]> = {}): Promise<void> {
    await manager.create({ chatId, cwd: home, ...request });
    manager.attach(chatId, 'c1');
}

describe('ChatManager over real processes', () => {
    test('Claude Code answers over its pipes and a crash reports the exit code', async () => {
        await open('chat-claude');
        await manager.send('chat-claude', 'hello there');
        await waitFor(() => recorder.idle, 'the Claude turn to end');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: hello there']);
        expect(manager.get('chat-claude')?.pid).toBeGreaterThan(0);

        await manager.send('chat-claude', 'crash');
        await waitFor(() => recorder.crashed, 'the Claude process to exit');
        expect(recorder.ofKind('note').at(-1)).toMatchObject({ level: 'error', text: 'Claude Code exited with code 1' });
    });

    test('a crash says what Claude Code wrote on stderr last, read to the end of the pipe', async () => {
        await open('chat-loud');
        await manager.send('chat-loud', 'crash loudly');
        await waitFor(() => recorder.crashed, 'the Claude process to exit');
        const note = recorder.ofKind('note').at(-1);
        expect(note?.text.startsWith('Claude Code exited with code 1\n\n```\n')).toBe(true);
        expect(note?.text.endsWith('Error: the fake lost its key\n    at handleUser (fake-claude.ts)\n```')).toBe(true);
    });

    test('a disposed chat takes along what its CLI started, not only the CLI', async () => {
        await open('chat-tree');
        await manager.send('chat-tree', 'start a grandchild');
        await waitFor(() => recorder.idle, 'the Claude turn to end');
        const pid = Number(/^grandchild (\d+)$/.exec(recorder.ofKind('assistant')[0]?.text ?? '')?.[1]);
        expect(processAlive(pid)).toBe(true);
        try {
            await manager.get('chat-tree')!.dispose();
            // Reaped by whoever adopts it, which takes a moment after the signal.
            await waitFor(() => !processAlive(pid), 'the grandchild to go');
        } finally {
            if (pid > 0) {
                killQuietly(pid);
            }
        }
    });

    test('Codex answers over its pipes and a crash reports the exit code', async () => {
        await open('chat-codex', { provider: 'codex' });
        await manager.send('chat-codex', 'hello there');
        await waitFor(() => recorder.idle, 'the Codex turn to end');
        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: hello there (medium)']);
        expect(manager.get('chat-codex')?.pid).toBeGreaterThan(0);

        await manager.send('chat-codex', 'crash');
        await waitFor(() => recorder.crashed, 'the Codex process to exit');
        expect(recorder.ofKind('note').at(-1)).toMatchObject({ level: 'error', text: 'Codex exited with code 1' });
    });
});
