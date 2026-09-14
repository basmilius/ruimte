import { describe, expect, test } from 'bun:test';
import { SUGGESTED_TITLE_LIMIT } from '@ruimte/contracts';
import { codexProvider } from '../providers/codex-provider.ts';
import type { ChatProvider } from '../providers/provider.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { buildTitlePrompt, parseTitle, suggestChatTitle } from './chat-title.ts';

describe('parseTitle', () => {
    test('takes the title out of the last object, around whatever the CLI printed', () => {
        expect(parseTitle('{"title": "Fix the build"}')).toBe('Fix the build');
        expect(parseTitle('Sure, here it is:\n{ "title": "Eerste versie" }\n')).toBe('Eerste versie');
        expect(parseTitle('{"title": "old"}\n{"title": "Refactor the parser."}')).toBe('Refactor the parser');
    });

    test('refuses output that holds no title object', () => {
        expect(parseTitle('Fix the build')).toBeNull();
        expect(parseTitle('{"subject": "Fix the build"}')).toBeNull();
        expect(parseTitle('{"title": 42}')).toBeNull();
        expect(parseTitle('{"title": "   "}')).toBeNull();
        expect(parseTitle('{"title": "unterminated}')).toBeNull();
        expect(parseTitle('')).toBeNull();
    });

    test('flattens, unquotes and caps what the model wrote', () => {
        expect(parseTitle('{"title": "\\"Line one\\nline two\\u0007\\""}')).toBe('Line one line two');
        const long = parseTitle(JSON.stringify({ title: 'word '.repeat(40) }));
        expect(long?.length).toBeLessThanOrEqual(SUGGESTED_TITLE_LIMIT);
    });
});

describe('buildTitlePrompt', () => {
    test('caps a long prompt and answer', () => {
        const prompt = buildTitlePrompt('p'.repeat(10_000), 'a'.repeat(10_000));
        expect(prompt.length).toBeLessThan(4_500);
        expect(buildTitlePrompt('hello', '')).toContain('(nothing yet)');
    });
});

const scripted = (script: string): ChatProvider => ({ ...codexProvider, command: ['bun'], oneShotArgs: () => ['-e', script] });

const registryWith = (installed: string[], providers?: ChatProvider[]): ProviderRegistry =>
    new ProviderRegistry({
        ...(providers ? { providers } : {}),
        detect: async (command) => ({ installed: installed.includes(command), version: installed.includes(command) ? '1.0.0' : null })
    });

describe('suggestChatTitle', () => {
    const input = { cwd: process.cwd(), prompt: 'Why does the build fail?', answer: 'The lockfile is stale.' };

    test('the Codex of a Codex chat answers when it is the only CLI, and nothing does when there is none', async () => {
        expect((await registryWith(['codex']).oneShotProvider('codex'))?.kind).toBe('codex');
        expect((await registryWith(['claude', 'codex']).oneShotProvider('codex'))?.kind).toBe('codex');
        expect(await registryWith([]).oneShotProvider('codex')).toBeNull();
        expect(await suggestChatTitle(registryWith([]), 'codex', input)).toBeNull();
    });

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
