import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentKind, ProviderAccounts, ProviderInfo } from '@ruimte/contracts';
import type { SessionEvent } from '../../sessions/manager.ts';
import { providerFor } from '../registry.ts';
import { ProviderAccountsService } from './service.ts';
import type { ShadowHomeReport } from './shadow-home.ts';
import type { AccountReading } from './status.ts';

const env = { HOME: '/home/bas', ANTHROPIC_API_KEY: 'sk-ant' };
const installed = new Set<AgentKind>(['claude', 'codex', 'copilot']);
const providers = {
    list: async () => [...installed].map((kind) => ({ kind, installed: true }) as ProviderInfo),
    get: (kind: AgentKind) => providerFor(kind)
};

interface Asked {
    kind: AgentKind;
    folder: string | undefined;
    apiKey: string | undefined;
}

describe('ProviderAccountsService', () => {
    let dir: string;
    let asked: Asked[];
    let answers: Record<string, AccountReading | Error>;
    let folders: Set<string>;
    let installs: string[];
    let shadows: string[];
    let shadowReport: ShadowHomeReport;
    let events: ProviderAccounts[];

    const make = async (): Promise<ProviderAccountsService> => {
        const service = new ProviderAccountsService({
            ruimteHome: dir,
            providers,
            env,
            ask: async (kind, _command, askedEnv) => {
                const folder = kind === 'claude' ? askedEnv.CLAUDE_CONFIG_DIR : askedEnv.CODEX_HOME;
                asked.push({ kind, folder, apiKey: askedEnv.ANTHROPIC_API_KEY });
                const answer = answers[folder ?? kind] ?? { signedIn: false, email: null, plan: null, organization: null };
                if (answer instanceof Error) {
                    throw answer;
                }
                return answer;
            },
            folderExists: async (path) => folders.has(path),
            prepareShadow: async (home, shadow) => {
                shadows.push(`${home} <- ${shadow}`);
                return shadowReport;
            },
            install: async (kind, folder) => {
                installs.push(`${kind} ${folder}`);
            },
            now: () => 1_000
        });
        await service.load();
        service.subscribe('client', (event: SessionEvent) => {
            if (event.event === 'providers.changed') {
                events.push(event.payload);
            }
        });
        return service;
    };

    const stateOf = (snapshot: ProviderAccounts, id: string) => snapshot.statuses.find((status) => status.id === id);

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'ruimte-accounts-'));
        asked = [];
        answers = { claude: { signedIn: true, email: 'work@example.com', plan: 'max', organization: 'Work' } };
        folders = new Set(['/home/bas/.claude_personal', '/home/bas/.codex', '/home/bas/.codex_personal']);
        installs = [];
        shadows = [];
        shadowReport = { linked: [], unshared: [], sharedLogin: false };
        events = [];
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    test('without a file every CLI has its default account, checking until its CLI answered', async () => {
        const service = await make();
        const before = service.snapshot();
        expect(Object.keys(before.accounts)).toEqual(['claude', 'codex', 'gemini', 'copilot']);
        expect(before.statuses.every((status) => status.state === 'checking')).toBe(true);

        const after = await service.refresh();
        expect(stateOf(after, 'claude')).toMatchObject({
            state: 'ready',
            email: 'work@example.com',
            plan: 'max',
            organization: 'Work',
            home: '/home/bas/.claude'
        });
        expect(stateOf(after, 'codex')).toMatchObject({ state: 'signed-out', home: '/home/bas/.codex' });
        expect(stateOf(after, 'gemini')?.state).toBe('not-found');
        expect(stateOf(after, 'copilot')?.state).toBe('ready');
        // The default accounts run in the daemon's own environment, key and all.
        expect(asked).toEqual([
            { kind: 'claude', folder: undefined, apiKey: 'sk-ant' },
            { kind: 'codex', folder: undefined, apiKey: 'sk-ant' }
        ]);
        expect(installs).toEqual([]);
    });

    test('a saved account is written, answered as checking and then asked in its own folder', async () => {
        const service = await make();
        answers['/home/bas/.claude_personal'] = { signedIn: true, email: 'me@example.com', plan: 'pro', organization: null };
        const saved = await service.save({ claude_personal: { kind: 'claude', label: 'Personal', color: 'green', home: '~/.claude_personal' } });
        expect(stateOf(saved, 'claude_personal')?.state).toBe('checking');
        expect(events).toHaveLength(1);

        const file = JSON.parse(await readFile(join(dir, 'providers.json'), 'utf8'));
        expect(file.version).toBe(1);
        expect(file.accounts.claude_personal).toEqual({ kind: 'claude', label: 'Personal', color: 'green', home: '~/.claude_personal' });

        const after = await service.refresh();
        expect(stateOf(after, 'claude_personal')).toMatchObject({ state: 'ready', email: 'me@example.com', home: '/home/bas/.claude_personal' });
        expect(asked).toContainEqual({ kind: 'claude', folder: '/home/bas/.claude_personal', apiKey: undefined });
        expect(installs).toContain('claude /home/bas/.claude_personal');
        expect(events.at(-1)).toEqual(after);
    });

    test('a folder that is not there is said without starting a CLI, and so is an account that is off', async () => {
        const service = await make();
        await service.save({ claude_gone: { kind: 'claude', home: '/nowhere' }, claude_off: { kind: 'claude', home: '~/.claude_personal', enabled: false } });
        const after = await service.refresh();
        expect(stateOf(after, 'claude_gone')).toMatchObject({ state: 'folder-missing', message: '/nowhere does not exist' });
        expect(stateOf(after, 'claude_off')?.state).toBe('disabled');
        expect(asked.length).toBeGreaterThan(0);
        expect(asked.every((entry) => entry.folder === undefined)).toBe(true);
        expect(installs).toEqual([]);
    });

    test('a Codex shadow home is linked to the home it shares before the CLI is asked', async () => {
        const service = await make();
        await service.save({ codex_personal: { kind: 'codex', home: '~/.codex', shadowHome: '~/.codex_personal' } });
        shadowReport = { linked: [], unshared: ['config.toml'], sharedLogin: false };
        const after = await service.refresh();
        // The pass the save started and the refresh after it both prepare the same folders again.
        expect(new Set(shadows)).toEqual(new Set(['/home/bas/.codex <- /home/bas/.codex_personal']));
        expect(new Set(installs)).toEqual(new Set(['codex /home/bas/.codex']));
        expect(asked).toContainEqual({ kind: 'codex', folder: '/home/bas/.codex_personal', apiKey: 'sk-ant' });
        expect(stateOf(after, 'codex_personal')).toMatchObject({
            state: 'signed-out',
            home: '/home/bas/.codex_personal',
            message: 'Not shared with /home/bas/.codex: config.toml'
        });

        shadowReport = { linked: [], unshared: [], sharedLogin: true };
        expect(stateOf(await service.refresh(), 'codex_personal')?.state).toBe('failed');
    });

    test('a CLI that fails to answer is a failed account with its reason', async () => {
        answers.claude = new Error('Claude Code did not answer in time');
        const service = await make();
        expect(stateOf(await service.refresh(), 'claude')).toMatchObject({ state: 'failed', message: 'Claude Code did not answer in time' });
    });

    test('publishes only when a person would read something else', async () => {
        const service = await make();
        await service.refresh();
        expect(events).toHaveLength(1);
        await service.refresh();
        expect(events).toHaveLength(1);
        answers.claude = { signedIn: false, email: null, plan: null, organization: null };
        await service.refresh();
        expect(events).toHaveLength(2);
    });

    test('an account a save changed is published again once checked, even when its CLI says the same', async () => {
        const service = await make();
        await service.refresh();
        await service.save({ claude: { kind: 'claude', label: 'Work' } });
        expect(stateOf(events.at(-1)!, 'claude')?.state).toBe('checking');
        await service.refresh();
        expect(stateOf(events.at(-1)!, 'claude')?.state).toBe('ready');
    });

    test('refuses a save with a mistake in it and leaves the file alone', async () => {
        const service = await make();
        expect(service.save({ claude_personal: { kind: 'claude' } })).rejects.toThrow('claude_personal');
        expect(service.save({ claude: { kind: 'claude', home: '~/.x' } })).rejects.toThrow();
        expect(readFile(join(dir, 'providers.json'), 'utf8')).rejects.toThrow();
    });

    test('keeps an account of a kind it does not know as it was written, and says it is unavailable', async () => {
        const raw = { kind: 'cursor', home: '~/.cursor', future: 1 };
        await writeFile(join(dir, 'providers.json'), JSON.stringify({ version: 1, accounts: { cursor_work: raw, claude_bad: { kind: 'claude' } } }));
        const service = await make();
        const snapshot = service.snapshot();
        expect(snapshot.accounts.cursor_work).toEqual({ kind: 'cursor', home: '~/.cursor' });
        expect(snapshot.accounts.claude_bad).toBeUndefined();

        await service.save({ ...snapshot.accounts, cursor_work: { kind: 'cursor' } });
        const file = JSON.parse(await readFile(join(dir, 'providers.json'), 'utf8'));
        expect(file.accounts.cursor_work).toEqual(raw);
        expect(stateOf(await service.refresh(), 'cursor_work')?.state).toBe('unavailable');
    });

    test('gives a launch the environment of its account', async () => {
        const service = await make();
        await service.save({ claude_personal: { kind: 'claude', home: '~/.claude_personal' } });
        expect(service.envFor('claude', env)).toBe(env);
        expect(service.envFor('claude_personal', env)).toEqual({ HOME: '/home/bas', CLAUDE_CONFIG_DIR: '/home/bas/.claude_personal' });
        expect(service.envFor('nobody', env)).toBeNull();
    });
});
