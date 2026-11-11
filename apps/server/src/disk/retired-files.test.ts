import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeRetiredFiles } from './retired-files.ts';

let home: string;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-retired-'));
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('the files an earlier Ruimte left', () => {
    test('lose the grants of port sharing, so an older Ruimte on this home shares nothing again', async () => {
        await mkdir(join(home, 'ports'));
        await writeFile(join(home, 'ports', 'grants.json'), '{"grants":[{"port":5173}]}');

        await removeRetiredFiles(home);

        expect(await Bun.file(join(home, 'ports', 'grants.json')).exists()).toBe(false);
    });

    test('leave a home without them as it was', async () => {
        await removeRetiredFiles(home);

        expect(await Bun.file(join(home, 'ports')).exists()).toBe(false);
    });
});
