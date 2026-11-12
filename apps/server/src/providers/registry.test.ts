import { describe, expect, test } from 'bun:test';
import { hasHooks } from '../agents/hooks.ts';
import { ProviderRegistry } from './registry.ts';
import { tableKinds } from './table.ts';

describe('ProviderRegistry', () => {
    test('lists CLIs and API providers with their capabilities, the frontier labs first and the API providers last', async () => {
        const registry = new ProviderRegistry({ detect: async () => ({ installed: true, version: '1.2.3' }) });
        const providers = await registry.list();
        expect(providers.map((provider) => provider.kind).toSorted()).toEqual(tableKinds().toSorted());
        expect(providers.map((provider) => provider.name)).toEqual(['Claude Code', 'Codex', 'Antigravity', 'GitHub Copilot', 'Grok', 'Claude API', 'NanoGPT']);
        expect(providers.map((provider) => provider.capabilities.chat)).toEqual([true, true, true, true, true, true, true]);
        expect(providers.map((provider) => provider.capabilities.terminal)).toEqual([true, true, true, true, true, false, false]);
        for (const provider of providers) {
            expect(provider.capabilities.hooks).toBe(hasHooks(provider.kind));
        }
    });

    test('every CLI says how a person installs it and signs it in', async () => {
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
    });

    test('Antigravity is installed once `agy` is, and chats once its server is there too', async () => {
        let serverPath: string | null = null;
        const server = { launch: () => (serverPath === null ? null : [serverPath]) };
        const probed: string[] = [];
        const registry = new ProviderRegistry({
            serverLaunches: { antigravity: server },
            detect: async (command) => {
                probed.push(command);
                return { installed: command === 'agy', version: command === 'agy' ? '1.4.0' : null };
            }
        });
        const antigravity = async () => (await registry.list()).find((provider) => provider.kind === 'antigravity');

        expect(await antigravity()).toMatchObject({ installed: true, version: '1.4.0', capabilities: { chat: false, terminal: true } });
        serverPath = '/srv/agy_acp_server.par';
        registry.invalidate('antigravity');
        expect(await antigravity()).toMatchObject({ installed: true, version: '1.4.0', capabilities: { chat: true, terminal: true } });
        expect(registry.get('antigravity').command).toEqual(['/srv/agy_acp_server.par']);
        expect(probed).not.toContain('/srv/agy_acp_server.par');
    });

    /*
     * What an extra account takes from the default one, as `apps/server/README.md` ("Sharing the default Claude account")
     * names it. A change here changes what crosses between two of a person's accounts, so it changes that section too.
     */
    test('only Claude Code shares a setup between accounts: five entries by link and five settings by copy, never a login', () => {
        const registry = new ProviderRegistry();
        const sharing = tableKinds().filter((kind) => registry.get(kind).home?.share !== undefined);

        expect(sharing).toEqual(['claude']);
        expect(registry.get('claude').home?.share).toEqual({
            links: ['CLAUDE.md', 'rules', 'skills', 'agents', 'commands'],
            seed: { file: 'settings.json', keys: ['permissions', 'hooks', 'model', 'statusLine', 'outputStyle'] }
        });
    });

    test('a kind this daemon does not offer gets a provider that starts nothing, never another CLI', async () => {
        const provider = new ProviderRegistry().get('future-cli');
        expect(provider.kind).toBe('future-cli');
        expect(provider.capabilities.chat).toBe(false);
        expect(provider.capabilities.terminal).toBe(false);
        expect(await new ProviderRegistry({ detect: async () => ({ installed: true, version: null }) }).list()).not.toContainEqual(
            expect.objectContaining({ kind: 'future-cli' })
        );
    });

    describe('a single prompt', () => {
        const only = (...commands: string[]) => new ProviderRegistry({ detect: async (command) => ({ installed: commands.includes(command), version: null }) });

        test('goes to Grok or Copilot when that is the one CLI here, read-only and without asking', async () => {
            const grok = await only('grok').oneShotProvider();
            expect(grok?.kind).toBe('grok');
            expect(grok?.oneShotArgs?.('name it')).toEqual([
                '--no-auto-update',
                '-p',
                'name it',
                '--output-format',
                'plain',
                '--permission-mode',
                'default',
                '--disallowed-tools',
                'Agent'
            ]);
            const copilot = await only('copilot').oneShotProvider();
            expect(copilot?.kind).toBe('copilot');
            expect(copilot?.oneShotArgs?.('name it')).toEqual(['--no-auto-update', '-p', 'name it', '-s', '--no-ask-user', '--deny-tool=shell, write']);
            expect(copilot?.oneShotStdinArgs).toEqual(['--no-auto-update', '-s', '--no-ask-user', '--deny-tool=shell, write']);
        });

        test("goes to `agy` for Antigravity, whatever its chat's server", async () => {
            const agy = await only('agy').oneShotProvider();
            expect(agy?.kind).toBe('antigravity');
            expect([agy?.command[0], ...(agy?.oneShotArgs?.('name it') ?? [])]).toEqual(['agy', '-p', 'name it', '--output-format', 'text']);
        });

        test('keeps the CLI a chat runs on first, and the order of the list after it', async () => {
            expect((await only('claude', 'agy').oneShotProvider('antigravity'))?.command[0]).toBe('agy');
            expect((await only('claude', 'agy').oneShotProvider())?.kind).toBe('claude');
            expect((await only('grok', 'copilot').oneShotProvider('grok'))?.kind).toBe('grok');
            expect(await only().oneShotProvider()).toBeNull();
        });
    });
});
