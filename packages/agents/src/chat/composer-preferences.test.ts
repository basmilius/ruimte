import { describe, expect, test } from 'bun:test';
import type { ModelSelection } from '@ruimte/agent-contracts';
import { ComposerPreferences } from './composer-preferences.ts';

const opus: ModelSelection = { model: 'claude-opus-5', options: { effort: 'high' } };
const sonnet: ModelSelection = { model: 'claude-sonnet-5', options: {} };
const gpt: ModelSelection = { model: 'gpt-5-codex', options: {} };

describe('ComposerPreferences', () => {
    test('with no client connected a chat gets the daemon defaults', () => {
        expect(new ComposerPreferences().for('claude')).toEqual({});
    });

    test('one client decides the mode and the model of its own provider', () => {
        const preferences = new ComposerPreferences();
        preferences.set('mac', { runtimeMode: 'supervised', selections: { claude: opus }, changedAt: 10 });
        expect(preferences.for('claude')).toEqual({ runtimeMode: 'supervised', selection: opus });
        // A model picked for another CLI means nothing here, so the CLI's own default stays.
        expect(preferences.for('codex')).toEqual({ runtimeMode: 'supervised' });
    });

    test('the account picked for a CLI goes with that CLI only', () => {
        const preferences = new ComposerPreferences();
        preferences.set('mac', { accounts: { claude: 'claude_personal' }, changedAt: 10 });
        expect(preferences.for('claude')).toEqual({ account: 'claude_personal' });
        expect(preferences.for('codex')).toEqual({});
    });

    test('the newest pick wins, however late its client told it', () => {
        const preferences = new ComposerPreferences();
        preferences.set('ipad', { runtimeMode: 'auto', selections: { claude: sonnet, codex: gpt }, changedAt: 20 });
        // The Mac reconnects afterwards with a pick made before the one on the iPad.
        preferences.set('mac', { runtimeMode: 'supervised', selections: { claude: opus }, changedAt: 10 });
        expect(preferences.for('claude')).toEqual({ runtimeMode: 'auto', selection: sonnet });
    });

    test('two picks of the same moment go to the one told last, and a client without a moment is the oldest', () => {
        const preferences = new ComposerPreferences();
        preferences.set('mac', { runtimeMode: 'supervised', changedAt: 10 });
        preferences.set('ipad', { runtimeMode: 'auto', changedAt: 10 });
        preferences.set('older', { runtimeMode: 'full-access' });
        expect(preferences.for('claude')).toEqual({ runtimeMode: 'auto' });
    });

    test('a client that goes takes its pick with it', () => {
        const preferences = new ComposerPreferences();
        preferences.set('mac', { runtimeMode: 'supervised', changedAt: 10 });
        preferences.set('ipad', { runtimeMode: 'auto', changedAt: 20 });
        preferences.forget('ipad');
        expect(preferences.for('claude')).toEqual({ runtimeMode: 'supervised' });
        preferences.forget('mac');
        expect(preferences.for('claude')).toEqual({});
    });

    test('the terminal mode comes from the newest pick, and nothing with no client', () => {
        const preferences = new ComposerPreferences();
        expect(preferences.terminalMode()).toBeUndefined();
        preferences.set('mac', { runtimeMode: 'full-access', terminalRuntimeMode: 'supervised', changedAt: 10 });
        preferences.set('ipad', { runtimeMode: 'auto', changedAt: 20 });
        // The newest client said nothing about terminals, so a terminal gets the daemon's own default.
        expect(preferences.terminalMode()).toBeUndefined();
        preferences.forget('ipad');
        expect(preferences.terminalMode()).toBe('supervised');
    });
});
