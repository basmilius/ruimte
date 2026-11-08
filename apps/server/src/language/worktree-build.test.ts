import { beforeEach, describe, expect, it } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { WorktreeBuildChoices } from './worktree-build.ts';

let folder = '';

const newHome = tempHomes('ruimte-worktree-build-');

beforeEach(async () => {
    folder = await newHome();
});

describe('worktree build choices', () => {
    it('allows no repository until a person does, and remembers the choice per main checkout', async () => {
        const path = join(folder, 'nested', 'worktree-build.json');
        const choices = new WorktreeBuildChoices({ path });
        await choices.load();

        expect(choices.isOn('/repos/a')).toBe(false);

        await choices.set('/repos/b', true);
        await choices.set('/repos/a', true);

        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ on: ['/repos/a', '/repos/b'] });

        const again = new WorktreeBuildChoices({ path });
        await again.load();

        expect([again.isOn('/repos/a'), again.isOn('/repos/b'), again.isOn('/repos/c')]).toEqual([true, true, false]);

        await again.set('/repos/a', false);

        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ on: ['/repos/b'] });
    });

    it('allows nothing from a file it cannot read', async () => {
        const path = join(folder, 'broken.json');
        await writeFile(path, '{');
        const choices = new WorktreeBuildChoices({ path });
        await choices.load();

        expect(choices.isOn('/repos/a')).toBe(false);

        await writeFile(path, JSON.stringify({ on: ['/repos/a', 3] }));
        await choices.load();

        expect([choices.isOn('/repos/a'), choices.isOn('3')]).toEqual([true, false]);
    });
});
