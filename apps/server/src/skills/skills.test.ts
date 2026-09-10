import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { discoverSkills, parseFrontmatter, pluginSkillRoots } from './skills.ts';

let home = '';
let project = '';

const writeSkill = async (dir: string, folder: string, body: string): Promise<void> => {
    await mkdir(join(dir, folder), { recursive: true });
    await writeFile(join(dir, folder, 'SKILL.md'), body);
};

beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-skills-'));
    project = join(home, 'work', 'app');
    await mkdir(join(project, 'src'), { recursive: true });
    await writeFile(join(home, 'work', 'app', '.git'), 'gitdir: elsewhere');

    await writeSkill(join(home, '.claude', 'skills'), 'unslop', '---\nname: unslop\ndescription: Edit prose.\n---\n\nBody.\n');
    await writeSkill(join(home, '.claude', 'skills'), 'folded', '---\nname: folded\ndescription: >-\n  A long one\n  over two lines.\n---\n');
    // No front matter name: the folder names the skill.
    await writeSkill(join(home, '.claude', 'skills'), 'nameless', '# Nameless\n');
    await writeSkill(join(project, '.claude', 'skills'), 'deploy', '---\nname: deploy\ndescription: Ship it.\n---\n');
    await writeSkill(join(home, '.agents', 'skills'), 'oklch', '---\nname: oklch\ndescription: Colors.\n---\n');
    await writeSkill(join(project, '.agents', 'skills'), 'codex-only', '---\nname: codex-only\ndescription: For Codex.\n---\n');

    const install = join(home, '.claude', 'plugins', 'cache', 'frontend-design');
    await writeSkill(join(install, 'skills'), 'frontend-design', '---\nname: frontend-design\ndescription: Visual design.\n---\n');
    await mkdir(join(home, '.claude', 'plugins'), { recursive: true });
    await writeFile(
        join(home, '.claude', 'plugins', 'installed_plugins.json'),
        JSON.stringify({ version: 2, plugins: { 'frontend-design@official': [{ scope: 'user', installPath: install }] } })
    );
});

afterAll(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('parseFrontmatter', () => {
    test('reads plain keys and strips quotes', () => {
        expect(parseFrontmatter('---\nname: "a b"\ndescription: c\n---\nbody')).toEqual({ name: 'a b', description: 'c' });
    });

    test('folds a block scalar onto one line and keeps a literal one', () => {
        expect(parseFrontmatter('---\ndescription: >-\n  one\n  two\n---\n').description).toBe('one two');
        expect(parseFrontmatter('---\ndescription: |\n  one\n  two\n---\n').description).toBe('one\ntwo');
    });

    test('a file without front matter has no fields', () => {
        expect(parseFrontmatter('# Title\n')).toEqual({});
    });
});

describe('discoverSkills', () => {
    test('Claude sees the user folder, the project folder and the plugins', async () => {
        const skills = await discoverSkills('claude', join(project, 'src'), { home });
        expect(skills.map((skill) => skill.name)).toEqual(['deploy', 'folded', 'frontend-design:frontend-design', 'nameless', 'unslop']);
        expect(skills.find((skill) => skill.name === 'deploy')?.source).toBe('project');
        expect(skills.find((skill) => skill.name === 'unslop')?.source).toBe('user');
        expect(skills.find((skill) => skill.name === 'frontend-design:frontend-design')?.source).toBe('plugin');
    });

    test('a folded description comes back as one line', async () => {
        const skills = await discoverSkills('claude', project, { home });
        expect(skills.find((skill) => skill.name === 'folded')?.description).toBe('A long one over two lines.');
    });

    test('a folder without a name in its front matter is named after the folder', async () => {
        const skills = await discoverSkills('claude', project, { home });
        expect(skills.find((skill) => skill.name === 'nameless')?.description).toBe('');
    });

    test('Codex looks in its own roots and never in Claude`s', async () => {
        const skills = await discoverSkills('codex', project, { home });
        expect(skills.map((skill) => skill.name)).toEqual(['codex-only', 'oklch']);
    });

    test('a folder with nothing in it answers nothing', async () => {
        expect(await discoverSkills('claude', join(home, 'empty'), { home, claudeConfigDir: join(home, 'nowhere') })).toEqual([]);
    });
});

describe('pluginSkillRoots', () => {
    test('a missing plugin file is not an error', async () => {
        expect(await pluginSkillRoots(join(home, 'nowhere'))).toEqual([]);
    });
});
