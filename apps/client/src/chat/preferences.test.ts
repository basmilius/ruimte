import { describe, expect, test } from 'bun:test';
import type { ModelSelection } from '@ruimte/contracts';
import {
    accountFor,
    chatPreferencesPayload,
    DEFAULT_CHAT_PREFERENCES,
    defaultProvider,
    parseChatPreferences,
    selectionFor,
    withAccount,
    withSelection,
    type ChatPreferences
} from './preferences';

const sonnet: ModelSelection = { model: 'claude-sonnet-5', options: { effort: 'high' } };
const gpt: ModelSelection = { model: 'gpt-5-codex', options: {} };

const preferences = (patch: Partial<ChatPreferences> = {}): ChatPreferences => ({ ...DEFAULT_CHAT_PREFERENCES, ...patch });

describe('selectionByProvider', () => {
    test('a pick lands in its own provider and leaves the others alone', () => {
        const first = withSelection(preferences(), 'claude', sonnet);
        const second = withSelection(first, 'codex', gpt);
        expect(second.selectionByProvider).toEqual({ claude: sonnet, codex: gpt });
    });

    test('the last pick is the global default', () => {
        const after = withSelection(withSelection(preferences(), 'claude', sonnet), 'codex', gpt);
        expect(defaultProvider(after)).toBe('codex');
        expect(defaultProvider(withSelection(after, 'claude', sonnet))).toBe('claude');
    });

    test('nothing remembered means no default provider and no selection', () => {
        expect(defaultProvider(preferences())).toBeNull();
        expect(selectionFor(preferences(), null)).toBeNull();
        expect(selectionFor(preferences(), 'claude')).toBeNull();
    });
});

describe('the default chain', () => {
    const remembered = preferences({ selectionByProvider: { claude: sonnet, codex: gpt }, lastProvider: 'codex' });

    test('a named provider takes its own model, never the global default', () => {
        expect(selectionFor(remembered, 'claude')).toEqual(sonnet);
    });

    test('without a provider the last used one answers', () => {
        expect(selectionFor(remembered, null)).toEqual(gpt);
        expect(selectionFor(remembered, undefined)).toEqual(gpt);
    });

    test('a provider that was never picked for falls through to the daemon', () => {
        expect(selectionFor(remembered, 'gemini')).toBeNull();
    });
});

describe('reading what is stored', () => {
    test('an empty store is the defaults', () => {
        expect(parseChatPreferences(null)).toEqual(DEFAULT_CHAT_PREFERENCES);
    });

    test('unreadable JSON is the defaults', () => {
        expect(parseChatPreferences('{ not json')).toEqual(DEFAULT_CHAT_PREFERENCES);
    });

    test('the older global selection and the plan toggle are dropped', () => {
        const parsed = parseChatPreferences(JSON.stringify({ selection: sonnet, interactionMode: 'plan', runtimeMode: 'supervised' }));
        expect(parsed).toEqual(preferences({ runtimeMode: 'supervised' }));
    });

    test('what is stored wins over the defaults', () => {
        const stored = {
            selectionByProvider: { claude: sonnet },
            lastProvider: 'claude',
            runtimeMode: 'auto',
            terminalRuntimeMode: 'supervised',
            accountByMachine: { local: { claude: 'claude_work' } },
            changedAt: 42
        };
        expect(parseChatPreferences(JSON.stringify(stored))).toEqual(stored as ChatPreferences);
    });

    test('preferences written before the moment of a change was kept count as the oldest pick', () => {
        expect(parseChatPreferences(JSON.stringify({ runtimeMode: 'auto' })).changedAt).toBe(0);
    });
});

describe('what a machine is told', () => {
    test('the modes, a model per provider and the moment of the last change', () => {
        const remembered = preferences({
            selectionByProvider: { claude: sonnet, codex: gpt },
            lastProvider: 'codex',
            runtimeMode: 'supervised',
            terminalRuntimeMode: 'auto',
            changedAt: 7
        });
        // The terminal mode too, since the machine starts terminal agents a verb opened on its own.
        expect(chatPreferencesPayload(remembered, 'local')).toEqual({
            runtimeMode: 'supervised',
            terminalRuntimeMode: 'auto',
            selections: { claude: sonnet, codex: gpt },
            changedAt: 7
        });
    });

    test('only the accounts picked on that machine', () => {
        const remembered = preferences({ accountByMachine: { local: { claude: 'claude_work' }, studio: { codex: 'codex_client' } } });
        expect(chatPreferencesPayload(remembered, 'local').accounts).toEqual({ claude: 'claude_work' });
        expect(chatPreferencesPayload(remembered, 'elsewhere').accounts).toBeUndefined();
    });
});

describe('the account for new agents', () => {
    test('is kept per machine and per CLI', () => {
        const picked = withAccount(withAccount(preferences(), 'local', 'claude', 'claude_work'), 'studio', 'claude', 'claude_home');
        expect(accountFor(picked, 'local', 'claude')).toBe('claude_work');
        expect(accountFor(picked, 'studio', 'claude')).toBe('claude_home');
        expect(accountFor(picked, 'local', 'codex')).toBeNull();
    });

    test('picking the default account takes the pick away', () => {
        const picked = withAccount(preferences(), 'local', 'claude', 'claude_work');
        expect(withAccount(picked, 'local', 'claude', 'claude').accountByMachine).toEqual({});
        expect(withAccount(picked, 'local', 'claude', null).accountByMachine).toEqual({});
    });

    test('survives a reload', () => {
        const stored = JSON.stringify({ accountByMachine: { local: { codex: 'codex_client' } } });
        expect(parseChatPreferences(stored).accountByMachine).toEqual({ local: { codex: 'codex_client' } });
    });
});
