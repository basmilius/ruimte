import { describe, expect, test } from 'bun:test';
import type { AgentKind, ProviderAccounts, ProviderAccountStatus, ProviderInfo } from '@ruimte/contracts';
import {
    cliRowsOf,
    doneCount,
    factsOf,
    firstPlace,
    isDone,
    joinNames,
    missingClisOf,
    placeAfter,
    summaryOf,
    taskLine,
    tasksOf,
    type OnboardingFacts
} from './tasks';

function provider(kind: AgentKind, name: string, installed: boolean): ProviderInfo {
    return {
        kind,
        name,
        installed,
        version: installed ? '1.0.0' : null,
        models: [],
        defaultModel: null,
        // Only whether it chats is read here.
        capabilities: { chat: kind !== 'antigravity' } as ProviderInfo['capabilities'],
        resumeCommand: ''
    };
}

function status(id: string, kind: string, state: ProviderAccountStatus['state']): ProviderAccountStatus {
    return {
        id,
        kind,
        state,
        email: null,
        plan: null,
        organization: null,
        home: '',
        message: null,
        checkedAt: 1
    };
}

const PROVIDERS = [
    provider('claude', 'Claude Code', true),
    provider('codex', 'Codex', true),
    provider('antigravity', 'Antigravity', false),
    provider('copilot', 'Copilot', false),
    provider('apple', 'Apple Foundation Models', false)
];

function accounts(states: Partial<Record<string, ProviderAccountStatus['state']>>): ProviderAccounts {
    return {
        accounts: {
            claude: { kind: 'claude' },
            claude_work: { kind: 'claude', label: 'Work', home: '~/.claude_work' },
            codex: { kind: 'codex' }
        },
        statuses: [
            status('claude', 'claude', states.claude ?? 'signed-out'),
            status('claude_work', 'claude', states.claude_work ?? 'signed-out'),
            status('codex', 'codex', states.codex ?? 'signed-out')
        ],
        loginCommands: { claude: 'claude auth login', codex: 'codex login' }
    };
}

function facts(patch: Partial<OnboardingFacts> = {}): OnboardingFacts {
    return { introSeen: false, loggedIn: [], notLoggedIn: [], computer: 'off', ...patch };
}

describe('the tasks of the onboarding', () => {
    test('offer computer use only where the helper can run', () => {
        expect(tasksOf('off')).toEqual(['intro', 'providers', 'computer']);
        expect(tasksOf('unknown')).toEqual(['intro', 'providers', 'computer']);
        expect(tasksOf('unsupported')).toEqual(['intro', 'providers']);
        expect(tasksOf('unavailable')).toEqual(['intro', 'providers']);
    });

    test('are done once seen, once a provider is logged in, and once computer use is ready', () => {
        expect(isDone('intro', facts({ introSeen: true }))).toBe(true);
        expect(isDone('providers', facts({ loggedIn: ['Codex'] }))).toBe(true);
        expect(isDone('providers', facts({ notLoggedIn: ['Codex'] }))).toBe(false);
        expect(isDone('computer', facts({ computer: 'grants' }))).toBe(false);
        expect(isDone('computer', facts({ computer: 'ready' }))).toBe(true);
        expect(doneCount(tasksOf('ready'), facts({ introSeen: true, computer: 'ready' }))).toBe(2);
    });

    test('open on the first task not done, and move on to the next one that is not', () => {
        const tasks = tasksOf('off');
        expect(firstPlace(tasks, facts())).toBe('intro');
        expect(firstPlace(tasks, facts({ introSeen: true }))).toBe('providers');
        expect(firstPlace(tasks, facts({ introSeen: true, loggedIn: ['Codex'], computer: 'ready' }))).toBe('done');
        expect(placeAfter(tasks, 'intro', facts({ introSeen: true }))).toBe('providers');
        expect(placeAfter(tasks, 'intro', facts({ introSeen: true, loggedIn: ['Codex'] }))).toBe('computer');
        // Skipping the last task goes back to one left undone, and to the end once none is.
        expect(placeAfter(tasks, 'computer', facts({ loggedIn: ['Codex'] }))).toBe('intro');
        expect(placeAfter(tasks, 'computer', facts({ introSeen: true, loggedIn: ['Codex'] }))).toBe('done');
    });
});

describe('the providers task', () => {
    test('API providers never become CLIs to install or log in to', () => {
        const apis = [provider('nanogpt', 'NanoGPT', true), provider('anthropic-claude-api', 'Claude API', true)];
        expect(cliRowsOf(apis, accounts({}))).toEqual([]);
        expect(missingClisOf(apis)).toEqual([]);
    });

    test('lists the installed CLIs, logs in the default account and names the missing ones in one row', () => {
        const rows = cliRowsOf(PROVIDERS, accounts({ claude_work: 'ready' }));
        expect(rows.map((row) => row.provider.kind)).toEqual(['claude', 'codex']);
        expect(rows[0]?.loggedIn?.id).toBe('claude_work');
        expect(rows[0]?.loginAccount?.id).toBe('claude');
        expect(rows[1]?.loggedIn).toBeNull();
        expect(missingClisOf(PROVIDERS)).toEqual(['Antigravity', 'Copilot']);
        expect(joinNames(missingClisOf(PROVIDERS))).toBe('Antigravity and Copilot');
        expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
    });

    test('counts a login only for a CLI that has one, and says who', () => {
        const antigravity = cliRowsOf([provider('antigravity', 'Antigravity', true)], {
            ...accounts({}),
            accounts: { antigravity: { kind: 'antigravity' } },
            statuses: [status('antigravity', 'antigravity', 'ready')]
        });
        expect(antigravity[0]?.canLogIn).toBe(false);
        expect(antigravity[0]?.loggedIn).toBeNull();
        const done = factsOf(true, cliRowsOf(PROVIDERS, accounts({ claude: 'ready' })), 'off');
        expect(done.loggedIn).toEqual(['Claude Code']);
        expect(done.notLoggedIn).toEqual(['Codex']);
        expect(taskLine('providers', done)).toBe('Claude Code logged in');
        expect(taskLine('providers', facts())).toBe('Not set up yet');
    });
});

describe('the end of the walk', () => {
    test('says what is done and what waits where', () => {
        const tasks = tasksOf('ready');
        expect(summaryOf(tasks, facts({ loggedIn: ['Claude Code'], notLoggedIn: ['Codex'], computer: 'ready' }))).toBe(
            'Claude Code is logged in and computer use is on. Log in to Codex later under Settings › Providers.'
        );
        expect(summaryOf(tasks, facts({ loggedIn: ['Claude Code', 'Codex'], computer: 'off' }))).toBe(
            'Claude Code and Codex are logged in. Turn on computer use later under Settings › Computer use.'
        );
        expect(summaryOf(tasksOf('unsupported'), facts({ computer: 'unsupported' }))).toBe(
            'Log in to an agent CLI under Settings › Providers before your first chat.'
        );
    });
});
