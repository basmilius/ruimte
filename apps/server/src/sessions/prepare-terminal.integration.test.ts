import { expect, test } from 'bun:test';
import { shellSyntax } from './prepare-terminal.ts';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('shell syntax validation never executes a command or accepts incomplete syntax', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ruimte-prepare-syntax-'));
    const sentinel = join(directory, 'must-not-exist');
    try {
        for (const language of ['sh', 'bash', 'zsh'] as const) {
            expect(await shellSyntax(language, `touch '${sentinel}'`)).toBe(true);
            expect(await shellSyntax(language, 'echo "unfinished')).toBe(false);
            expect(await shellSyntax(language, 'echo ok &&')).toBe(false);
            expect(await shellSyntax(language, 'cat <<EOF')).toBe(false);
            expect(await shellSyntax(language, 'echo ok \\')).toBe(false);
            expect(await shellSyntax(language, `echo $(touch '${sentinel}')`)).toBe(true);
        }
        await expect(access(sentinel)).rejects.toThrow();
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
