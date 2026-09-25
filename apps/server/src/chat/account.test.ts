import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatInfo, ChatTurnItem, ProjectCanvasView, ProjectContent } from '@ruimte/contracts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { testAccounts } from '../providers/accounts/test-accounts.ts';
import { bootTestDaemon, type TestDaemon } from '../tasks/test-daemon.ts';
import { ChatStore } from './chat-store.ts';
import { claudeProjectSlug } from './claude-transcript.ts';

const content = (): ProjectContent => ({
    name: 'repo',
    color: '#123456',
    views: [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [
                { id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude', providerFixed: true },
                { id: 'chat-codex', kind: 'chat', title: 'Codex', x: 600, y: 0, w: 560, h: 640, provider: 'codex', providerFixed: true }
            ],
            texts: [],
            edges: [],
            layouts: []
        }
    ]
});

let root: string;
let home: string;
let folder: string;
let personal: string;
let folders: Set<string>;
let store: ProjectStore;
let projectId: string;
let daemon: TestDaemon;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-chat-account-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    personal = join(root, 'claude_personal');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(home);
    const opened = await store.openProject({ folder });
    projectId = opened.summary.projectId;
    await store.save(projectId, opened.document.rev, content());
    store.release(projectId);
    const env = { PATH: process.env.PATH, HOME: home, ANTHROPIC_API_KEY: 'sk-inherited' };
    folders = new Set([personal, join(home, '.codex'), join(root, 'codex_work')]);
    const accounts = await testAccounts({
        ruimteHome: home,
        env,
        accounts: {
            claude_personal: { kind: 'claude', label: 'Personal', home: personal },
            claude_gone: { kind: 'claude', label: 'Gone', home: join(root, 'claude_gone') },
            codex_work: { kind: 'codex', label: 'Work', home: '~/.codex', shadowHome: join(root, 'codex_work') }
        },
        folders
    });
    daemon = await bootTestDaemon({ home, store, clock: new ManualClock(), installed: ['claude', 'codex'], accounts, env });
    daemon.worker.start();
});

afterEach(async () => {
    await daemon.stop();
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

const turnsOf = (chatId: string): ChatTurnItem[] =>
    (daemon.chats.get(chatId)?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn');

const say = async (chatId: string, text: string): Promise<void> => {
    const before = turnsOf(chatId).length;
    await daemon.chats.send(chatId, text);
    await daemon.until(() => daemon.chats.get(chatId)?.info.activeTurnId === null && turnsOf(chatId).length === before + 1);
};

describe('a chat under an account', () => {
    test('without one starts its CLI in the environment of the machine', async () => {
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder, account: 'claude' });
        await say('chat-lead', 'hello');
        expect(daemon.chats.get('chat-lead')!.info.account).toBeUndefined();
        expect(daemon.chatEnvs.at(-1)!.CLAUDE_CONFIG_DIR).toBeUndefined();
        expect(daemon.chatEnvs.at(-1)!.ANTHROPIC_API_KEY).toBe('sk-inherited');
    });

    test('starts its CLI in the folder of the account, and keeps the account in its record', async () => {
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder, account: 'claude_personal' });
        await say('chat-lead', 'hello');
        expect(daemon.chatEnvs.at(-1)!.CLAUDE_CONFIG_DIR).toBe(personal);
        expect(daemon.chatEnvs.at(-1)!.ANTHROPIC_API_KEY).toBeUndefined();
        daemon.chats.persistAllSync();
        expect((await new ChatStore(home).read('chat-lead'))!.info.account).toBe('claude_personal');
        expect(daemon.chats.claudeProjectsDirOf({ account: 'claude_personal' })).toBe(join(personal, 'projects'));
    });

    test('refuses a new chat on an account that cannot start, and fails the turn of one whose folder went', async () => {
        const refused = await daemon.request('chat.create', { chatId: 'chat-lead', provider: 'claude', cwd: folder, account: 'claude_gone' });
        expect(refused).toMatchObject({
            ok: false,
            error: {
                code: 'account-unavailable',
                message: `The account 'Gone' is not available on this machine: its folder ${join(root, 'claude_gone')} is missing.`
            }
        });
        expect(daemon.chats.get('chat-lead')).toBeUndefined();

        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder, account: 'claude_personal' });
        folders.delete(personal);
        const started = daemon.chatEnvs.length;
        await say('chat-lead', 'hello');
        expect(daemon.chatEnvs).toHaveLength(started);
        expect(JSON.stringify(daemon.chats.get('chat-lead')!.thread.list())).toContain("The account 'Personal' is not available on this machine");
    });

    test('takes any account before its first turn and only one that reads the same transcripts after it', async () => {
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        expect(await daemon.request('chat.configure', { chatId: 'chat-lead', account: 'claude_personal' })).toMatchObject({
            ok: true,
            result: { account: 'claude_personal' }
        });
        await say('chat-lead', 'hello');
        const refused = await daemon.request('chat.configure', { chatId: 'chat-lead', account: 'claude' });
        expect(refused).toMatchObject({ ok: false, error: { code: 'account-incompatible', message: expect.stringContaining('Fork the chat') } });
        expect(daemon.chats.get('chat-lead')!.info.account).toBe('claude_personal');
    });

    test('a Codex chat moves to an account that shares its home, and its next turn starts there', async () => {
        await daemon.chats.create({ chatId: 'chat-codex', provider: 'codex', cwd: folder });
        await say('chat-codex', 'hello');
        expect(daemon.chatEnvs.at(-1)!.CODEX_HOME).toBeUndefined();
        expect(await daemon.request('chat.configure', { chatId: 'chat-codex', account: 'codex_work' })).toMatchObject({ ok: true });
        await say('chat-codex', 'again');
        expect(daemon.chatEnvs.at(-1)!.CODEX_HOME).toBe(join(root, 'codex_work'));
        expect(daemon.chats.codexProcess(daemon.chats.get('chat-codex')!.info).env.CODEX_HOME).toBe(join(root, 'codex_work'));
    });
});

describe('a fork under an account', () => {
    test('onto an account that cannot read the transcript carries the conversation over as text', async () => {
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        await say('chat-lead', 'alpha');
        const [turn] = turnsOf('chat-lead');
        const answer = await daemon.request('chat.fork', { chatId: 'chat-lead', turnId: turn!.id, account: 'claude_personal' });
        expect(answer).toMatchObject({ ok: true });
        const { nodeId, info } = (answer as { result: { nodeId: string; info: ChatInfo } }).result;
        expect(info).toMatchObject({ provider: 'claude', account: 'claude_personal', agentSessionId: null });
        const record = (await new ChatStore(home).read(nodeId))!;
        expect(record.preambles[0]).toContain('you take over a conversation');
        expect(record.items.at(-1)).toMatchObject({ kind: 'note', text: expect.stringContaining("continued with Claude Code under the account 'Personal'") });
        const canvas = (await store.read(projectId)).views[0] as ProjectCanvasView;
        expect(canvas.nodes.find((node) => node.id === nodeId)).toMatchObject({ account: 'claude_personal' });
    });

    test('without an account stays on the original one and copies the transcript in its folder', async () => {
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder, account: 'claude_personal' });
        await say('chat-lead', 'alpha');
        const lead = daemon.chats.get('chat-lead')!;
        const [turn] = turnsOf('chat-lead');
        const sessionId = lead.info.agentSessionId!;
        const dir = join(personal, 'projects', claudeProjectSlug(folder));
        await mkdir(dir, { recursive: true });
        const lines = [
            { type: 'user', uuid: 'prompt-0', isSidechain: false, sessionId, message: { role: 'user', content: 'alpha' } },
            { type: 'assistant', uuid: turn!.native!.lastUuid, isSidechain: false, sessionId, message: { content: [{ type: 'text', text: 'echo' }] } }
        ];
        await writeFile(join(dir, `${sessionId}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));

        const answer = await daemon.request('chat.fork', { chatId: 'chat-lead', turnId: turn!.id });
        const { info } = (answer as { result: { info: ChatInfo } }).result;
        expect(info.account).toBe('claude_personal');
        expect(existsSync(join(dir, `${info.agentSessionId}.jsonl`))).toBe(true);
        expect(existsSync(join(home, '.claude', 'projects', claudeProjectSlug(folder), `${info.agentSessionId}.jsonl`))).toBe(false);
    });
});
