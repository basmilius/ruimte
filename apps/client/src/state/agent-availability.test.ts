import { describe, expect, test } from 'bun:test';
import type { ProviderInfo } from '@ruimte/contracts';
import { availableAgents } from './agent-availability';

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
