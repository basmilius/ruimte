import { describe, expect, test } from 'bun:test';
import type { ProviderInfo } from '@ruimte/contracts';
import { availableAgents, separatesGroups } from './agent-availability';

const provider = (kind: string, name: string, installed = true): ProviderInfo =>
    ({ kind, name, installed, capabilities: { chat: true, terminal: true } }) as ProviderInfo;

describe('availableAgents', () => {
    test('offers the frontier labs, then the rest, then the API providers, each by name, whatever order the machine sent', () => {
        const providers = [
            provider('grok', 'Grok'),
            provider('claude', 'Claude Code'),
            provider('nanogpt', 'NanoGPT'),
            provider('codex', 'Codex'),
            provider('copilot', 'GitHub Copilot'),
            provider('anthropic-claude-api', 'Claude API'),
            provider('antigravity', 'Antigravity'),
            provider('kimi', 'Kimi', false)
        ];
        const names = availableAgents(providers, 'chat').map((entry) => entry.name);
        expect(names).toEqual(['Claude Code', 'Codex', 'Antigravity', 'GitHub Copilot', 'Grok', 'Claude API', 'NanoGPT']);
    });
});

describe('separatesGroups', () => {
    test('only where one group ends and the next begins', () => {
        expect(separatesGroups('codex', 'antigravity')).toBe(true);
        expect(separatesGroups('grok', 'anthropic-claude-api')).toBe(true);
        expect(separatesGroups('claude', 'codex')).toBe(false);
        expect(separatesGroups('antigravity', 'grok')).toBe(false);
        expect(separatesGroups('anthropic-claude-api', 'nanogpt')).toBe(false);
        expect(separatesGroups(undefined, 'grok')).toBe(false);
    });
});
