import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderRegistry, providerFor } from '../providers/registry.ts';
import { suggestMessage } from './message.ts';
import { readCapabilities } from './capabilities.ts';
import { gitIn, initRepo } from './test-repo.ts';

test('a commit suggestion respects its writer budget without splitting UTF-8 or changing the staged diff', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-text-message-'));
    let input = '';

    try {
        await initRepo(home, { 'a.txt': 'before\n' });
        await writeFile(join(home, 'a.txt'), '変更'.repeat(2000) + '\nEND OF PATCH\n');
        await gitIn(home, ['add', 'a.txt']);
        const before = await gitIn(home, ['diff', '--cached']);
        const result = await suggestMessage(home, {} as never, {
            writer: {
                provider: providerFor('apple'),
                budget: { patchBytes: 256, nameStatusBytes: 128, promptBytes: 2048, conflictBytes: 500 },
                run: async (_cwd, prompt) => {
                    input = prompt;
                    return { code: 0, stdout: '{"subject":"Update text","body":""}', stderr: '' };
                }
            }
        });
        const patch = input.split('Patch:\n')[1]!;
        expect(Buffer.byteLength(patch)).toBeLessThanOrEqual(256);
        expect(patch).not.toContain('\uFFFD');
        expect(patch).not.toContain('END OF PATCH');
        expect(result).toEqual({ subject: 'Update text', body: '' });
        expect(await gitIn(home, ['diff', '--cached'])).toBe(before);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('capabilities retain an explicit Apple choice even when no CLI is installed', async () => {
    const registry = new ProviderRegistry({ providers: [], detect: async () => ({ installed: false, version: null }) });
    expect((await readCapabilities(registry, 0, 'apple')).messageProvider).toBe('apple');
});
