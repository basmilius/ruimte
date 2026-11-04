import { expect, test } from 'bun:test';
import { closeSync, constants, fstatSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { withCreateParent } from './create-parent.ts';

const newHome = tempHomes('ruimte-create-parent-');

test('a held creation directory cannot redirect a write when its name is swapped', async () => {
    const root = await realpath(await newHome());
    const base = join(root, 'src');
    const outside = join(root, 'outside');
    const moved = join(root, 'old-src');
    await mkdir(base);
    await mkdir(outside);
    const expected = await stat(base);

    withCreateParent(base, expected, [], (parent) => {
        if (process.platform === 'win32') {
            expect(() => renameSync(base, moved)).toThrow();
        } else {
            renameSync(base, moved);
            symlinkSync(outside, base);
        }

        const descriptor = parent.open('proof.txt', constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);

        try {
            writeFileSync(descriptor, 'proof');

            if (process.platform !== 'win32') {
                expect(fstatSync(descriptor).mode & 0o777).toBe(0o600);
            }
        } finally {
            closeSync(descriptor);
        }
    });

    expect(await stat(join(outside, 'proof.txt')).catch(() => null)).toBeNull();
    expect(await readFile(join(process.platform === 'win32' ? base : moved, 'proof.txt'), 'utf8')).toBe('proof');
});

test('a missing child replaced by a symlink is refused without creating anything in its target', async () => {
    const root = await realpath(await newHome());
    const outside = join(root, 'outside');
    await mkdir(outside);
    symlinkSync(outside, join(root, 'linked'), 'junction');
    const expected = await stat(root);

    expect(() => withCreateParent(root, expected, ['linked', 'deep'], () => undefined)).toThrow();
    expect(await stat(join(outside, 'deep')).catch(() => null)).toBeNull();
});
