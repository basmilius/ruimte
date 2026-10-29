import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatInfo, ChatTurnItem, ProjectCanvasView, ProjectContent } from '@ruimte/contracts';
import { ManualClock, testAccounts } from '@adecore/agents/testing';
import { setProjectAccounts } from '../projects/project-accounts.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import type { ProviderAccountsService } from '@adecore/agents/providers';
import type { LimitsUpdate } from '@adecore/agents/usage';
import { bootTestDaemon, releasedProject, runVerb, type TestDaemon } from '../tasks/test-daemon.ts';
import { ChatStore, claudeProjectSlug } from '@adecore/agents/chat';
import { turnsOf } from './chat-test-helpers.ts';
import { sayAndSettle, writeLeadTranscript } from './lead-chat-test-helpers.ts';

function content(): ProjectContent {
    return {
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
    };
}

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
let clock: ManualClock;

beforeEach(async () => {
    ({ root, home, folder, store, projectId } = await releasedProject('ruimte-chat-account-', content()));
    personal = join(root, 'claude_personal');
    const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: 'sk-inherited' };
    folders = new Set([personal, join(home, '.codex'), join(root, 'codex_work')]);
    limitUpdates = [];
    machine = { resumeAtReset: false };
    accounts = await testAccounts({
        home,
        env,
        accounts: {
            claude_personal: { kind: 'claude', label: 'Personal', home: personal },
            claude_gone: { kind: 'claude', label: 'Gone', home: join(root, 'claude_gone') },
            codex_work: { kind: 'codex', label: 'Work', home: '~/.codex', shadowHome: join(root, 'codex_work') }
        },
        folders
    });
    clock = new ManualClock();
    daemon = await bootTestDaemon({
        home,
        store,
        clock,
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

function turnsIn(chatId: string): ChatTurnItem[] {
    return turnsOf(daemon.chats.get(chatId)?.thread.list() ?? []);
}

function say(chatId: string, text: string): Promise<void> {
    return sayAndSettle(daemon, chatId, text);
}

/* Has the lead chat start an agent and answers its node id. */
async function openAgent(argv: string[]): Promise<string> {
    const [line] = await runVerb(daemon, 'chat-lead', 'agent', argv);
    return line!.split('\t')[0]!;
}

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
        const [turn] = turnsIn('chat-lead');
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
        const [turn] = turnsIn('chat-lead');
        const projects = join(personal, 'projects');
        await writeLeadTranscript(daemon, folder, [turn!], { projectsDir: projects });
        const dir = join(projects, claudeProjectSlug(folder));

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
        expect(turnsIn('chat-codex')[0]).toMatchObject({ state: 'error', limit: { kind: 'usage' } });

        const answer = await daemon.request('chat.continueOn', { chatId: 'chat-codex', account: 'codex_work' });
        expect(answer).toMatchObject({ ok: true, result: { chatId: 'chat-codex' } });
        expect((answer as { result: { fork?: unknown } }).result.fork).toBeUndefined();
        await daemon.until(() => turnsIn('chat-codex').length === 2 && daemon.chats.get('chat-codex')?.info.activeTurnId === null);
        expect(daemon.chats.get('chat-codex')!.info.account).toBe('codex_work');
        expect(turnsIn('chat-codex')[1]).toMatchObject({ origin: 'agent', label: 'Continued on Work', state: 'done' });
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
        await daemon.until(() => turnsIn(chatId).length === 2 && daemon.chats.get(chatId)?.info.activeTurnId === null);
        // The fake stops on the limit line again, which the handed over conversation still holds.
        expect(turnsIn(chatId)[1]).toMatchObject({ origin: 'agent', label: 'Continued on Personal' });
        expect(daemon.chatEnvs.at(-1)!.CLAUDE_CONFIG_DIR).toBe(personal);

        expect(owedResumes().filter((entry) => entry.target === 'chat-lead')).toEqual([]);
        expect(daemon.chats.get('chat-lead')!.info.account).toBeUndefined();
        expect(daemon.chats.get('chat-lead')!.info.resumeAt).toBeUndefined();
        expect(turnsIn('chat-lead')).toHaveLength(1);

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

    test('a Codex chat whose CLI still runs a command in the background is refused, and keeps the resume it is owed', async () => {
        machine.resumeAtReset = true;
        await daemon.chats.create({ chatId: 'chat-codex', provider: 'codex', cwd: folder });
        await say('chat-codex', `serve\nlimit:${RESET_AT / 1000}`);
        await daemon.until(() => owedResumes().length === 1);
        expect(daemon.chats.get('chat-codex')!.info.background).toHaveLength(1);

        expect(await daemon.request('chat.continueOn', { chatId: 'chat-codex', account: 'codex_work' })).toMatchObject({
            ok: false,
            error: { code: 'chat-busy' }
        });
        expect(daemon.chats.get('chat-codex')!.info.account).toBeUndefined();
        expect(turnsIn('chat-codex')).toHaveLength(1);
        expect(owedResumes()).toHaveLength(1);
    });

    test('a resume that comes due while a change of account waits on a background command opens its turn once that command ends', async () => {
        machine.resumeAtReset = true;
        await daemon.chats.create({ chatId: 'chat-codex', provider: 'codex', cwd: folder });
        await say('chat-codex', `serve\nlimit:${RESET_AT / 1000}`);
        await daemon.until(() => owedResumes().length === 1);
        daemon.chats.configure({ chatId: 'chat-codex', account: 'codex_work' });

        clock.advance(RESET_AT - clock.now());
        await daemon.worker.settled();
        expect(turnsIn('chat-codex')).toHaveLength(1);
        expect(owedResumes()).toHaveLength(1);
        expect(daemon.chats.get('chat-codex')!.info.resumeAt).toBe(RESET_AT);

        daemon.codex.started.at(-1)!.runLater();
        await daemon.until(() => turnsIn('chat-codex').length === 2 && daemon.chats.get('chat-codex')?.info.activeTurnId === null);
        await daemon.worker.settled();
        expect(turnsIn('chat-codex')[1]).toMatchObject({ origin: 'agent', label: 'Usage limit reset' });
        expect(owedResumes()).toEqual([]);
        expect(daemon.chats.get('chat-codex')!.info.resumeAt).toBeUndefined();
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

describe('a turned-off default account', () => {
    // The manual clock starts at 1 000 000 ms, so the fakes are told a reset ten minutes on, in seconds.
    const RESET_AT = 1_600_000;

    // The way Providers turns it off: the whole list saved again, the default account with `enabled: false`.
    const turnOffDefault = async (): Promise<void> => {
        const { accounts: map } = accounts.snapshot();
        await accounts.save({ ...map, claude: { ...map.claude, kind: 'claude', enabled: false } });
    };

    // A transcript for the fake's one turn, in the folder of the default account, so a fork can copy it.
    const transcriptOf = async (chatId: string): Promise<ChatTurnItem> => {
        const [turn] = turnsIn(chatId);
        await writeLeadTranscript(daemon, folder, [turn!]);
        return turn!;
    };

    test('is handed to the accounts as named by a continue-on and a fork, not as the stored none', async () => {
        const named: Array<string | undefined> = [];
        const envFor = accounts.envFor.bind(accounts);
        accounts.envFor = (kind, id, baseEnv) => {
            named.push(id);
            return envFor(kind, id, baseEnv);
        };
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        await say('chat-lead', 'alpha');
        const turn = await transcriptOf('chat-lead');
        named.length = 0;
        expect(await daemon.request('chat.fork', { chatId: 'chat-lead', turnId: turn.id, account: 'claude' })).toMatchObject({ ok: true });
        expect(named).toContain('claude');

        await daemon.chats.create({ chatId: 'chat-limited', provider: 'claude', cwd: folder, account: 'claude_personal' });
        await say('chat-limited', `limit:${RESET_AT / 1000}`);
        named.length = 0;
        await daemon.request('chat.continueOn', { chatId: 'chat-limited', account: 'claude' });
        expect(named[0]).toBe('claude');
    });

    // Needs the daemon of ADE CORE to refuse a named default account that is off (`envFor`, `ChatCore.createNow`).
    test('refuses a new chat that names it, and starts one that names no account on the next account that is on', async () => {
        await turnOffDefault();
        const refused = await daemon.request('chat.create', { chatId: 'chat-lead', provider: 'claude', cwd: folder, account: 'claude' });
        expect(refused).toMatchObject({ ok: false, error: { code: 'account-unavailable', message: expect.stringContaining('it is turned off') } });
        expect(daemon.chats.get('chat-lead')).toBeUndefined();

        await accounts.reorder('claude', ['claude_personal']);
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        expect(daemon.chats.get('chat-lead')!.info.account).toBe('claude_personal');
    });

    // Needs the daemon of ADE CORE to refuse a named default account that is off (`envFor`).
    test('is refused for going on after a limit, and the chat stays where it was', async () => {
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder, account: 'claude_personal' });
        await say('chat-lead', `limit:${RESET_AT / 1000}`);
        await turnOffDefault();
        expect(await daemon.request('chat.continueOn', { chatId: 'chat-lead', account: 'claude' })).toMatchObject({
            ok: false,
            error: { code: 'account-unavailable', message: expect.stringContaining('it is turned off') }
        });
        expect(daemon.chats.get('chat-lead')!.info.account).toBe('claude_personal');
        expect(turnsIn('chat-lead')).toHaveLength(1);
    });

    // Needs the daemon of ADE CORE to refuse a named default account that is off (`envFor`).
    test('is refused for a fork that names it, also from a chat on it, while a fork that names none stays on it', async () => {
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        await say('chat-lead', 'alpha');
        const turn = await transcriptOf('chat-lead');
        await turnOffDefault();
        const forks = async (): Promise<number> => ((await store.read(projectId)).views[0] as ProjectCanvasView).nodes.length;
        const before = await forks();

        expect(await daemon.request('chat.fork', { chatId: 'chat-lead', turnId: turn.id, account: 'claude' })).toMatchObject({
            ok: false,
            error: { code: 'account-unavailable', message: expect.stringContaining('it is turned off') }
        });
        expect(await forks()).toBe(before);

        const inherited = await daemon.request('chat.fork', { chatId: 'chat-lead', turnId: turn.id });
        expect(inherited).toMatchObject({ ok: true });
        expect((inherited as { result: { info: ChatInfo } }).result.info.account).toBeUndefined();
    });
});

describe('a child an agent opens', () => {
    test('starts under the account of its opener when it runs the same CLI, and under the default one of another CLI', async () => {
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder, account: 'claude_personal' });
        await say('chat-lead', 'plan');

        const chatChild = await openAgent(['claude', '--prompt', 'look around']);
        const terminalChild = await openAgent(['claude', '--terminal', '--prompt', 'look around']);
        const codexChild = await openAgent(['codex', '--prompt', 'look around']);
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

describe('the top account of the order', () => {
    test('starts a new chat that names none, and not one that names the default account, whatever a client picked', async () => {
        await accounts.reorder('claude', ['claude_personal']);
        daemon.chats.composerPreferences.set('client-1', { accounts: { codex: 'codex_work' }, changedAt: 1 });
        await daemon.chats.create({ chatId: 'chat-picked', provider: 'claude', cwd: folder });
        await daemon.chats.create({ chatId: 'chat-default', provider: 'claude', cwd: folder, account: 'claude' });
        await daemon.chats.create({ chatId: 'chat-codex', provider: 'codex', cwd: folder });
        expect(daemon.chats.get('chat-picked')!.info.account).toBe('claude_personal');
        expect(daemon.chats.get('chat-default')!.info.account).toBeUndefined();
        expect(daemon.chats.get('chat-codex')!.info.account).toBeUndefined();
    });

    test('is refused and not replaced when that account went', async () => {
        await accounts.reorder('claude', ['claude_gone']);
        const refused = await daemon.request('chat.create', { chatId: 'chat-lead', provider: 'claude', cwd: folder });
        expect(refused).toMatchObject({ ok: false, error: { code: 'account-unavailable' } });
        expect(daemon.chats.get('chat-lead')).toBeUndefined();
    });

    test('never outranks the account a child inherits, and starts a child of another CLI', async () => {
        await accounts.reorder('claude', ['claude_personal']);
        await accounts.reorder('codex', ['codex_work']);
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder, account: 'claude' });
        await say('chat-lead', 'plan');

        const chatChild = await openAgent(['claude', '--prompt', 'look around']);
        const terminalChild = await openAgent(['claude', '--terminal', '--prompt', 'look around']);
        const codexChild = await openAgent(['codex', '--prompt', 'look around']);
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

describe("a project's accounts", () => {
    test("start a chat that names none on the project's default, and refuse one that names an account it turned off", async () => {
        await setProjectAccounts(store, { projectId, kind: 'claude', default: 'claude_personal', off: ['claude'] });
        const refused = await daemon.request('chat.create', { chatId: 'chat-lead', provider: 'claude', cwd: folder, account: 'claude' });
        expect(refused).toMatchObject({ ok: false, error: { code: 'account-off-in-project' } });
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        expect(daemon.chats.get('chat-lead')!.info.account).toBe('claude_personal');
    });

    test('say so in the chat when the default cannot take the start', async () => {
        await setProjectAccounts(store, { projectId, kind: 'claude', default: 'claude_gone', off: [] });
        await accounts.save({
            ...accounts.snapshot().accounts,
            claude_gone: { kind: 'claude', label: 'Gone', home: join(root, 'claude_gone'), enabled: false }
        });
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        expect(daemon.chats.get('chat-lead')!.info.account).toBeUndefined();
        const notes = daemon.chats
            .get('chat-lead')!
            .thread.list()
            .filter((item) => item.kind === 'note');
        expect(notes.map((item) => (item as { text: string }).text)).toContain('Started on Claude Code: Gone is turned off on this machine.');
    });

    test('drop an inherited account they turned off, for a chat child and a terminal child alike', async () => {
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder, account: 'claude' });
        await say('chat-lead', 'plan');
        await setProjectAccounts(store, { projectId, kind: 'claude', default: 'claude_personal', off: ['claude'] });

        const chatChild = await openAgent(['claude', '--prompt', 'look around']);
        const terminalChild = await openAgent(['claude', '--terminal', '--prompt', 'look around']);
        await daemon.until(() => daemon.chats.get(chatChild) !== undefined && daemon.sessions.get(terminalChild) !== undefined);

        expect(daemon.chats.get(chatChild)!.info.account).toBe('claude_personal');
        expect(daemon.adapter.forSession(terminalChild).options.env.CLAUDE_CONFIG_DIR).toBe(personal);
    });
});
