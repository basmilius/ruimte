import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatInfo, ChatTurnItem, ProjectCanvasView, ProjectContent } from '@ruimte/contracts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { ProjectStore } from '../projects/project-store.ts';
import type { ProviderAccountsService } from '../providers/accounts/service.ts';
import { testAccounts } from '../providers/accounts/test-accounts.ts';
import type { LimitsUpdate } from '../usage/limits/normalize.ts';
import { bootTestDaemon, runVerb, type TestDaemon } from '../tasks/test-daemon.ts';
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
let accounts: ProviderAccountsService;
let limitUpdates: LimitsUpdate[];
let machine: { resumeAtReset: boolean };

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
    limitUpdates = [];
    machine = { resumeAtReset: false };
    accounts = await testAccounts({
        ruimteHome: home,
        env,
        accounts: {
            claude_personal: { kind: 'claude', label: 'Personal', home: personal },
            claude_gone: { kind: 'claude', label: 'Gone', home: join(root, 'claude_gone') },
            codex_work: { kind: 'codex', label: 'Work', home: '~/.codex', shadowHome: join(root, 'codex_work') }
        },
        folders
    });
    daemon = await bootTestDaemon({
        home,
        store,
        clock: new ManualClock(),
        installed: ['claude', 'codex'],
        accounts,
        env,
        machine,
        onLimits: (update) => limitUpdates.push(update)
    });
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

    test('reports what a turn says about the plan on its account, which keeps that account read', async () => {
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder, account: 'claude_personal' });
        expect(accounts.lastLaunchAt('claude_personal')).toBeNull();
        await say('chat-lead', 'limit:1789000000');
        expect(limitUpdates.at(-1)).toMatchObject({ kind: 'claude', account: 'claude_personal', windows: [{ id: 'five_hour', used: 1 }] });
        expect(accounts.lastLaunchAt('claude_personal')).not.toBeNull();
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

describe('going on under another account after a limit', () => {
    // The manual clock starts at 1 000 000 ms, so the fakes are told a reset ten minutes on, in seconds.
    const RESET_AT = 1_600_000;
    const owedResumes = () => daemon.outbox.list().filter((entry) => entry.kind === 'resume-limit');

    test('a Codex chat moves to an account that shares its home and takes the limited turn up there', async () => {
        await daemon.chats.create({ chatId: 'chat-codex', provider: 'codex', cwd: folder });
        await say('chat-codex', `limit:${RESET_AT / 1000}`);
        expect(turnsOf('chat-codex')[0]).toMatchObject({ state: 'error', limit: { kind: 'usage' } });

        const answer = await daemon.request('chat.continueOn', { chatId: 'chat-codex', account: 'codex_work' });
        expect(answer).toMatchObject({ ok: true, result: { chatId: 'chat-codex' } });
        expect((answer as { result: { fork?: unknown } }).result.fork).toBeUndefined();
        await daemon.until(() => turnsOf('chat-codex').length === 2 && daemon.chats.get('chat-codex')?.info.activeTurnId === null);
        expect(daemon.chats.get('chat-codex')!.info.account).toBe('codex_work');
        expect(turnsOf('chat-codex')[1]).toMatchObject({ origin: 'agent', label: 'Continued on Work', state: 'done' });
        expect(daemon.chatEnvs.at(-1)!.CODEX_HOME).toBe(join(root, 'codex_work'));
    });

    test('a Claude chat goes on in a fork on the other account, and its own resume at the reset lapses', async () => {
        machine.resumeAtReset = true;
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        await say('chat-lead', `limit:${RESET_AT / 1000}`);
        await daemon.until(() => owedResumes().length === 1);

        const answer = await daemon.request('chat.continueOn', { chatId: 'chat-lead', account: 'claude_personal' });
        expect(answer).toMatchObject({ ok: true });
        const { chatId, fork } = (answer as { result: { chatId: string; fork: { nodeId: string; info: ChatInfo } } }).result;
        expect(chatId).toBe(fork.nodeId);
        expect(fork.info).toMatchObject({ provider: 'claude', account: 'claude_personal' });
        await daemon.until(() => turnsOf(chatId).length === 2 && daemon.chats.get(chatId)?.info.activeTurnId === null);
        // The fake stops on the limit line again, which the handed over conversation still holds.
        expect(turnsOf(chatId)[1]).toMatchObject({ origin: 'agent', label: 'Continued on Personal' });
        expect(daemon.chatEnvs.at(-1)!.CLAUDE_CONFIG_DIR).toBe(personal);

        expect(owedResumes().filter((entry) => entry.target === 'chat-lead')).toEqual([]);
        expect(daemon.chats.get('chat-lead')!.info.account).toBeUndefined();
        expect(daemon.chats.get('chat-lead')!.info.resumeAt).toBeUndefined();
        expect(turnsOf('chat-lead')).toHaveLength(1);

        // The fork took the turn over: turning the original's switch off and on again, reset still ahead, owes it nothing.
        const original = daemon.chats.get('chat-lead')!;
        expect(original.thread.list().filter((item) => item.kind === 'note' && item.text === "Continued under the account 'Personal' in a fork")).toHaveLength(
            1
        );
        original.configure({ resumeAtReset: false });
        original.configure({ resumeAtReset: true });
        machine.resumeAtReset = false;
        daemon.chats.resumeSettingChanged();
        machine.resumeAtReset = true;
        daemon.chats.resumeSettingChanged();
        expect(owedResumes().filter((entry) => entry.target === 'chat-lead')).toEqual([]);
        expect(original.info.resumeAt).toBeUndefined();
    });

    test('is refused for a chat whose last turn did not stop on a limit, and for the account it already runs under', async () => {
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        await say('chat-lead', 'hello');
        expect(await daemon.request('chat.continueOn', { chatId: 'chat-lead', account: 'claude_personal' })).toMatchObject({
            ok: false,
            error: { code: 'not-limited' }
        });
        expect(await daemon.request('chat.continueOn', { chatId: 'chat-lead', account: 'claude' })).toMatchObject({
            ok: false,
            error: { code: 'same-account' }
        });
        expect(await daemon.request('chat.continueOn', { chatId: 'chat-lead', account: 'claude_gone' })).toMatchObject({
            ok: false,
            error: { code: 'account-unavailable' }
        });
    });
});

describe('a child an agent opens', () => {
    const open = async (argv: string[]): Promise<string> => {
        const [line] = await runVerb(daemon, 'chat-lead', 'agent', argv);
        return line!.split('\t')[0]!;
    };

    test('starts under the account of its opener when it runs the same CLI, and under the default one of another CLI', async () => {
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder, account: 'claude_personal' });
        await say('chat-lead', 'plan');

        const chatChild = await open(['claude', '--prompt', 'look around']);
        const terminalChild = await open(['claude', '--terminal', '--prompt', 'look around']);
        const codexChild = await open(['codex', '--prompt', 'look around']);
        await daemon.until(
            () => daemon.chats.get(chatChild) !== undefined && daemon.sessions.get(terminalChild) !== undefined && daemon.chats.get(codexChild) !== undefined
        );

        expect(daemon.chats.get(chatChild)!.info.account).toBe('claude_personal');
        expect(daemon.chats.get(codexChild)!.info.account).toBeUndefined();
        expect(daemon.sessions.get(terminalChild)!.launch).toMatchObject({ kind: 'claude', account: 'claude_personal' });
        expect(daemon.adapter.forSession(terminalChild).options.env.CLAUDE_CONFIG_DIR).toBe(personal);

        // On the node too, so a client that starts it after a restart starts it the same way.
        const canvas = (await store.read(projectId)).views[0] as ProjectCanvasView;
        expect(canvas.nodes.find((node) => node.id === chatChild)?.account).toBe('claude_personal');
        expect(canvas.nodes.find((node) => node.id === terminalChild)?.account).toBe('claude_personal');
        expect(canvas.nodes.find((node) => node.id === codexChild)?.account).toBeUndefined();
    });
});

describe('the account a person picked for new agents', () => {
    const pick = (accounts: Partial<Record<'claude' | 'codex', string>>): void => {
        daemon.chats.composerPreferences.set('client-1', { accounts, changedAt: 1 });
    };

    test('starts a new chat that names none, and not one that names the default account', async () => {
        pick({ claude: 'claude_personal' });
        await daemon.chats.create({ chatId: 'chat-picked', provider: 'claude', cwd: folder });
        await daemon.chats.create({ chatId: 'chat-default', provider: 'claude', cwd: folder, account: 'claude' });
        await daemon.chats.create({ chatId: 'chat-codex', provider: 'codex', cwd: folder });
        expect(daemon.chats.get('chat-picked')!.info.account).toBe('claude_personal');
        expect(daemon.chats.get('chat-default')!.info.account).toBeUndefined();
        expect(daemon.chats.get('chat-codex')!.info.account).toBeUndefined();
    });

    test('is refused and not replaced when that account went', async () => {
        pick({ claude: 'claude_gone' });
        const refused = await daemon.request('chat.create', { chatId: 'chat-lead', provider: 'claude', cwd: folder });
        expect(refused).toMatchObject({ ok: false, error: { code: 'account-unavailable' } });
        expect(daemon.chats.get('chat-lead')).toBeUndefined();
    });

    test('never outranks the account a child inherits, and starts a child of another CLI', async () => {
        pick({ claude: 'claude_personal', codex: 'codex_work' });
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder, account: 'claude' });
        await say('chat-lead', 'plan');
        const open = async (argv: string[]): Promise<string> => {
            const [line] = await runVerb(daemon, 'chat-lead', 'agent', argv);
            return line!.split('\t')[0]!;
        };

        const chatChild = await open(['claude', '--prompt', 'look around']);
        const terminalChild = await open(['claude', '--terminal', '--prompt', 'look around']);
        const codexChild = await open(['codex', '--prompt', 'look around']);
        await daemon.until(
            () => daemon.chats.get(chatChild) !== undefined && daemon.sessions.get(terminalChild) !== undefined && daemon.chats.get(codexChild) !== undefined
        );

        expect(daemon.chats.get(chatChild)!.info.account).toBeUndefined();
        expect(daemon.adapter.forSession(terminalChild).options.env.CLAUDE_CONFIG_DIR).toBeUndefined();
        expect(daemon.chats.get(codexChild)!.info.account).toBe('codex_work');
        const canvas = (await store.read(projectId)).views[0] as ProjectCanvasView;
        expect(canvas.nodes.find((node) => node.id === terminalChild)?.account).toBe('claude');
    });
});
