import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeSkillDisk } from './skill-disk.ts';

let root: string;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-skill-disk-'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

test('a folder is replaced whole, and nothing written beside it stays', async () => {
    const folder = join(root, 'skills', 'ruimte-sketch');

    expect(await nodeSkillDisk.readFolder(folder)).toBeNull();

    await nodeSkillDisk.replaceFolder(folder, { 'SKILL.md': 'one', 'reference/shapes.md': 'boxes' });
    await nodeSkillDisk.replaceFolder(folder, { 'SKILL.md': 'two' });
    await nodeSkillDisk.writeText(join(root, 'skills', '.ruimte-skills.json'), '{}');

    expect(await nodeSkillDisk.readFolder(folder)).toEqual({ 'SKILL.md': 'two' });
    expect((await readdir(join(root, 'skills'))).sort()).toEqual(['.ruimte-skills.json', 'ruimte-sketch']);

    await nodeSkillDisk.remove(folder);

    expect(await nodeSkillDisk.readFolder(folder)).toBeNull();
});
