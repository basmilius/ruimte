import { describe, expect, test } from 'bun:test';
import { hasHooks } from '../agents/hooks.ts';
import { BUILT_IN_KINDS } from './kinds.ts';
import { ProviderRegistry, providerFor } from './registry.ts';

describe('ProviderRegistry', () => {
    test('lists CLIs and the disabled local model with their capabilities', async () => {
        const registry = new ProviderRegistry({ detect: async () => ({ installed: true, version: '1.2.3' }) });
        const providers = await registry.list();
        expect(providers.map((provider) => provider.kind)).toEqual([...BUILT_IN_KINDS]);
        expect(providers.map((provider) => provider.name)).toEqual([
            'Claude Code',
            'Codex',
            'Antigravity',
            'GitHub Copilot',
            'Grok',
            'Apple Foundation Models'
        ]);
        expect(providers.map((provider) => provider.capabilities.chat)).toEqual([true, true, true, true, true, true]);
        expect(providers.map((provider) => provider.capabilities.terminal)).toEqual([true, true, true, true, true, false]);
        for (const provider of providers) {
            expect(provider.capabilities.hooks).toBe(hasHooks(provider.kind));
        }
    });

    test('every CLI says how a person installs it and signs it in, and the local model says nothing', async () => {
        const registry = new ProviderRegistry({ detect: async () => ({ installed: false, version: null }) });
        const install = Object.fromEntries((await registry.list()).map((provider) => [provider.kind, provider.install]));
        expect(install.claude?.commands.darwin).toBe('curl -fsSL https://claude.ai/install.sh | bash');
        expect(install.codex?.commands.linux).toBe('npm install -g @openai/codex');
        expect(install.grok).toEqual({
            description: expect.any(String),
            commands: {
                darwin: 'curl -fsSL https://x.ai/cli/install.sh | bash',
                linux: 'curl -fsSL https://x.ai/cli/install.sh | bash',
                win32: 'irm https://x.ai/cli/install.ps1 | iex'
            },
            guideUrl: 'https://github.com/xai-org/grok-build',
            signIn: [
                { kind: 'command', command: 'grok login' },
                { kind: 'env', variable: 'XAI_API_KEY' }
            ]
        });
        expect(install.copilot?.commands).toEqual({
            darwin: 'npm install -g @github/copilot',
            linux: 'npm install -g @github/copilot',
            win32: 'npm install -g @github/copilot'
        });
        expect(install.copilot?.signIn).toEqual([
            { kind: 'command', command: 'copilot login' },
            { kind: 'env', variable: 'COPILOT_GITHUB_TOKEN' }
        ]);
        expect(install.antigravity?.commands).toEqual({
            darwin: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
            linux: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
            win32: 'irm https://antigravity.google/cli/install.ps1 | iex'
        });
        expect(install.antigravity?.signIn).toEqual([{ kind: 'chat' }, { kind: 'command', command: 'agy' }]);
        for (const kind of ['claude', 'codex', 'antigravity', 'copilot', 'grok']) {
            expect(install[kind]?.guideUrl).toStartWith('https://');
        }
        expect(install.apple).toBeUndefined();
    });

    test('Antigravity is there once its server is installed, and its chat starts that server', async () => {
        const server = { launch: () => ['/srv/agy_acp_server.par'], detection: () => ({ installed: true, version: '1.4.1' }) };
        const registry = new ProviderRegistry({ antigravityServer: server });
        const antigravity = registry.get('antigravity');
        expect(antigravity.command).toEqual(['/srv/agy_acp_server.par']);
        expect(await antigravity.detect('agy', {})).toEqual({ installed: true, version: '1.4.1' });
        expect(await new ProviderRegistry().get('antigravity').detect('agy', {})).toEqual({ installed: false, version: null });
    });

    test('a kind this daemon does not offer gets a provider that starts nothing, never another CLI', async () => {
        const provider = providerFor('future-cli');
        expect(provider.kind).toBe('future-cli');
        expect(provider.capabilities.chat).toBe(false);
        expect(provider.capabilities.terminal).toBe(false);
        expect(await new ProviderRegistry({ detect: async () => ({ installed: true, version: null }) }).list()).not.toContainEqual(
            expect.objectContaining({ kind: 'future-cli' })
        );
    });
});
