import { describe, expect, test } from 'bun:test';
import type { AgentIntegrationsSummary } from '@ruimte/contracts';
import { pendingReview, providersToKeep } from './agent-integrations';

function summary(
    claude: AgentIntegrationsSummary['providers'][number]['state'],
    reviewed: boolean,
    fixed = false,
    codex: typeof claude = 'off'
): AgentIntegrationsSummary {
    return {
        providers: [
            { provider: 'claude', state: claude, reviewed },
            { provider: 'codex', state: codex, reviewed: true }
        ],
        fixed
    };
}

describe('pendingReview', () => {
    test('asks nothing of a machine that did not say', () => {
        expect(pendingReview(null)).toBe(false);
        expect(pendingReview(undefined)).toBe(false);
    });

    test('asks about a provider nobody decided on', () => {
        expect(pendingReview(summary('unset', false))).toBe(true);
        expect(pendingReview(summary('off', true, false, 'unset'))).toBe(true);
    });

    test('asks once about a provider an earlier release wired up', () => {
        expect(pendingReview(summary('on', false))).toBe(true);
        expect(pendingReview(summary('on', true))).toBe(false);
    });

    test('has nothing to ask when every provider is decided', () => {
        expect(pendingReview(summary('off', true))).toBe(false);
        expect(pendingReview(summary('on', true, false, 'on'))).toBe(false);
    });

    test('has nothing to ask under --no-hooks, whatever the state', () => {
        expect(pendingReview(summary('unset', false, true))).toBe(false);
        expect(pendingReview(summary('on', false, true))).toBe(false);
    });
});

describe('providersToKeep', () => {
    test('keeps a migrated provider that was left without a choice', () => {
        expect(providersToKeep(summary('on', false), [], null)).toEqual(['claude']);
    });

    test('skips a provider the person answered or is answering', () => {
        expect(providersToKeep(summary('on', false), ['claude'], null)).toEqual([]);
        expect(providersToKeep(summary('on', false), [], 'claude')).toEqual([]);
    });

    test('skips reviewed and unset providers', () => {
        expect(providersToKeep(summary('on', true), [], null)).toEqual([]);
        expect(providersToKeep(summary('unset', false), [], null)).toEqual([]);
    });
});
