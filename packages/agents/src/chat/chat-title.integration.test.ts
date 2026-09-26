import { describe, expect, test } from 'bun:test';
import { codexProvider } from '../providers/codex-provider.ts';
import type { ChatProvider } from '../providers/provider.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { suggestChatTitle } from './chat-title.ts';

const scripted = (script: string): ChatProvider => ({ ...codexProvider, command: ['bun'], oneShotArgs: () => ['-e', script] });

const registryWith = (installed: string[], providers: ChatProvider[]): ProviderRegistry =>
    new ProviderRegistry({
        providers,
        detect: async (command) => ({ installed: installed.includes(command), version: installed.includes(command) ? '1.0.0' : null })
    });

describe('suggestChatTitle', () => {
    const input = { cwd: process.cwd(), prompt: 'Why does the build fail?', answer: 'The lockfile is stale.' };

    test('runs the one-shot CLI and parses what it printed', async () => {
        const good = scripted(`console.log('working...'); console.log(JSON.stringify({ title: 'Stale lockfile.' }))`);
        expect(await suggestChatTitle(registryWith(['bun'], [good]), 'codex', input)).toBe('Stale lockfile');
    });

    test('a CLI that fails or prints no title gives nothing', async () => {
        const failing = scripted(`console.log(JSON.stringify({ title: 'Nope' })); process.exit(1)`);
        expect(await suggestChatTitle(registryWith(['bun'], [failing]), 'codex', input)).toBeNull();
        const chatty = scripted(`console.log('Stale lockfile')`);
        expect(await suggestChatTitle(registryWith(['bun'], [chatty]), 'codex', input)).toBeNull();
    });
});
