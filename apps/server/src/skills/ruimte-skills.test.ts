import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { RUIMTE_SKILLS } from './catalog.ts';
import { builtInSkill, RuimteSkills, SKILLS_RECORD } from './ruimte-skills.ts';
import { MemorySkillDisk } from './skill-disk-test-helpers.ts';

const ROOT = '/home/r/skills';
const RECORD = at(SKILLS_RECORD);

/* A path under the skills folder as this platform writes it, which the daemon's own paths are. */
function at(...parts: string[]): string {
    return join(ROOT, ...parts);
}

const SKETCH = builtInSkill('sketch', {
    'SKILL.md': '---\nname: ruimte-sketch\ndescription: Draws a sketch.\n---\n\nDraw it.',
    'reference/shapes.md': 'Boxes and lines.'
});

function recordOf(disk: MemorySkillDisk): unknown {
    return JSON.parse(disk.files.get(RECORD) ?? 'null');
}

async function placed(disk: MemorySkillDisk, skills = [SKETCH]): Promise<RuimteSkills> {
    const shelf = new RuimteSkills(ROOT, skills, disk);
    await shelf.place();

    return shelf;
}

describe('the skills Ruimte ships', () => {
    test('each names itself and says in one sentence what it is for', () => {
        expect(RUIMTE_SKILLS.map((skill) => [skill.name, skill.title])).toEqual([['ruimte-design', 'design']]);
        expect(RUIMTE_SKILLS[0]!.description).toMatch(/^[A-Z][^.]+\.$/);
    });

    test('land in a folder each, which the record names, with a path to their instructions', async () => {
        const disk = new MemorySkillDisk();
        const shelf = await placed(disk);

        expect(disk.folder(at('ruimte-sketch'))).toEqual(SKETCH.files);
        expect(recordOf(disk)).toEqual({ folders: ['ruimte-sketch'] });
        expect(shelf.placed()).toEqual([{ skill: SKETCH, path: at('ruimte-sketch', 'SKILL.md') }]);
        expect(shelf.folder()).toBe(ROOT);
    });

    test('are written again where a file differs or one was added, and left alone where nothing did', async () => {
        const disk = new MemorySkillDisk();
        await placed(disk);
        disk.files.set(at('ruimte-sketch', 'SKILL.md'), 'edited by hand');
        disk.files.set(at('ruimte-sketch', 'extra.md'), 'left over');

        await placed(disk);

        expect(disk.folder(at('ruimte-sketch'))).toEqual(SKETCH.files);

        disk.failing.add('replaceFolder');
        disk.failing.add('writeText');
        const unchanged = await placed(disk);

        expect(unchanged.placed()[0]!.path).toBe(at('ruimte-sketch', 'SKILL.md'));
    });

    test('that left Ruimte are removed, and only the folders the record names', async () => {
        const disk = new MemorySkillDisk();
        await placed(disk);
        disk.files.set(at('mine', 'SKILL.md'), 'written by a person');
        disk.files.set(RECORD, JSON.stringify({ folders: ['ruimte-sketch', '../mine'] }));

        await placed(disk, []);

        expect(disk.folder(at('ruimte-sketch'))).toEqual({});
        expect(disk.folder(at('mine'))).toEqual({ 'SKILL.md': 'written by a person' });
        expect(recordOf(disk)).toEqual({ folders: [] });
    });

    test('never take over a folder of their name the daemon did not write, and hand their text instead', async () => {
        const disk = new MemorySkillDisk();
        disk.files.set(at('ruimte-sketch', 'SKILL.md'), 'written by a person');

        const shelf = await placed(disk);

        expect(disk.folder(at('ruimte-sketch'))).toEqual({ 'SKILL.md': 'written by a person' });
        expect(shelf.placed()).toEqual([{ skill: SKETCH, path: null }]);
        expect(shelf.folder()).toBeNull();
    });

    test('that fail to write are left without a path, and the start goes on', async () => {
        const disk = new MemorySkillDisk();
        disk.failing.add('replaceFolder');

        const shelf = await placed(disk);

        expect(shelf.placed()).toEqual([{ skill: SKETCH, path: null }]);
        expect(recordOf(disk)).toEqual({ folders: ['ruimte-sketch'] });

        disk.failing.delete('replaceFolder');

        expect((await placed(disk)).placed()[0]!.path).toBe(at('ruimte-sketch', 'SKILL.md'));
    });
});
