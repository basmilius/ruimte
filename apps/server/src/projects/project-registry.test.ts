import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { ProjectRegistry, type RegistryEntry } from './project-registry.ts';

let home: string;

const newHome = tempHomes('ruimte-registry-');

beforeEach(async () => {
    home = await newHome();
});

function entry(projectId: string): RegistryEntry {
    return { projectId, name: projectId, color: '#7c74ff', folder: join(home, projectId), lastOpenedAt: 1 };
}

describe('ProjectRegistry', () => {
    test('two changes at once both land, each on what the one before it wrote', async () => {
        const registry = new ProjectRegistry(home);
        await Promise.all([registry.update((entries) => [...entries, entry('a')]), registry.update((entries) => [...entries, entry('b')])]);

        const written = JSON.parse(await readFile(join(home, 'projects.json'), 'utf8')) as { projects: RegistryEntry[] };
        expect(written.projects.map((project) => project.projectId)).toEqual(['a', 'b']);
        expect((await new ProjectRegistry(home).load()).map((project) => project.projectId)).toEqual(['a', 'b']);
    });

    test('a change is written durably, so a power loss right after it leaves the old list or the new one', async () => {
        const writes: Array<{ target: string; durable: boolean | undefined }> = [];
        const registry = new ProjectRegistry(home, async (target, _content, _mode, options) => {
            writes.push({ target, durable: options?.durable });
        });
        await registry.update((entries) => [...entries, entry('a')]);

        expect(writes).toEqual([{ target: join(home, 'projects.json'), durable: true }]);
    });

    test('an entry that will not read is dropped and the rest is kept', async () => {
        await writeFile(join(home, 'projects.json'), JSON.stringify({ projects: [entry('a'), { projectId: 'loose', folder: null }] }));

        expect((await new ProjectRegistry(home).load()).map((project) => project.projectId)).toEqual(['a']);
    });

    test('a registry that will not parse starts empty, and an unknown project is refused', async () => {
        await writeFile(join(home, 'projects.json'), '{ not json');
        const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const registry = new ProjectRegistry(home);
            expect(await registry.load()).toEqual([]);
            await expect(registry.entry('nope')).rejects.toMatchObject({ code: 'project-not-found' });
        } finally {
            warn.mockRestore();
        }
    });
});
