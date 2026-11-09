import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderRegistry } from '../providers/registry.ts';
import { readCapabilities } from './capabilities.ts';
import { suggestMessage } from './message.ts';
import { gitIn, initRepo } from './test-repo.ts';

test('a commit message comes from the prepared writer and leaves the staged diff alone', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-text-message-'));
    const prompts: string[] = [];

    try {
        await initRepo(home, { 'a.txt': 'before\n' });
        await writeFile(join(home, 'a.txt'), 'after\n');
        await gitIn(home, ['add', 'a.txt']);

        const before = await gitIn(home, ['diff', '--cached']);
        const result = await suggestMessage(home, {} as never, {
            writer: {
                provider: new ProviderRegistry({ providers: [] }).get('codex'),
                run: async (_cwd, prompt) => {
                    prompts.push(prompt);

                    return { code: 0, stdout: '{"subject":"Update text","body":""}', stderr: '' };
                }
            }
        });

        expect(result).toEqual({ subject: 'Update text', body: '' });
        expect(prompts[0]).toContain('+after');
        expect(await gitIn(home, ['diff', '--cached'])).toBe(before);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('capabilities report an explicit pick even when no CLI is installed', async () => {
    const detect = async () => ({ installed: false, version: null });
    const registry = new ProviderRegistry({ providers: [], detect });

    expect((await readCapabilities(registry, 0, 'codex', detect)).messageProvider).toBe('codex');
    expect((await readCapabilities(registry, 0, undefined, detect)).messageProvider).toBeNull();
});
