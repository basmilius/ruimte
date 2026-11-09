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

    // Council round 17: two repositories saved their own snapshots side by side, and the older one could land last.
    it('saves the choices of two repositories in the order they were made, also when the first write is slower', async () => {
        const path = join(folder, 'worktree-build.json');
        const gate = Promise.withResolvers<void>();
        let writes = 0;
        const choices = new WorktreeBuildChoices({
            path,
            // The third write waits until another write landed, or until the test lets it go when none could start.
            write: async (target, text) => {
                const call = ++writes;

                if (call === 3) {
                    await gate.promise;
                }

                await writeFile(target, text);
                gate.resolve();
            }
        });
        await choices.set('/repos/a', true);
        await choices.set('/repos/b', true);

        const first = choices.set('/repos/a', false);
        const second = choices.set('/repos/b', false);

        if (writes < 4) {
            gate.resolve();
        }

        await Promise.all([first, second]);

        const again = new WorktreeBuildChoices({ path });
        await again.load();

        expect([again.isOn('/repos/a'), again.isOn('/repos/b')]).toEqual([false, false]);
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
