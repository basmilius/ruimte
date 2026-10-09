import { afterEach, describe, expect, test } from 'bun:test';
import { link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatImageFiles } from './image-files.ts';
import { MachineHome } from '../fs/machine-home.ts';

const IMAGE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
const folders: string[] = [];
afterEach(async () => {
    await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function fixture() {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-image-save-')));
    folders.push(home);
    const folder = join(home, 'project');
    await mkdir(join(folder, 'assets'), { recursive: true });
    const source = join(home, 'attachment.png');
    await writeFile(source, IMAGE);
    const machineHome = new MachineHome(join(folder, 'machine-state'));
    const files = new ChatImageFiles({
        project: async (chatId, clientId) => (chatId === 'chat' && clientId === 'person' ? { folder, name: 'Project' } : null),
        attachment: async (chatId, attachmentId) =>
            chatId === 'chat' && attachmentId === 'image' ? { id: 'image', name: 'rabbit.png', mime: 'image/png', size: IMAGE.length, path: source } : null,
        refusePath: (path) => machineHome.refuse(path)
    });
    const payload = { chatId: 'chat', attachmentId: 'image', path: 'assets/rabbit.png' };
    return { home, folder, source, files, payload };
}

describe('ChatImageFiles', () => {
    test('a project around the daemon home cannot save into machine state', async () => {
        const { folder, files, payload } = await fixture();
        await mkdir(join(folder, 'machine-state'));
        await writeFile(join(folder, 'machine-state', 'local.key'), 'secret');
        const protectedPath = { ...payload, path: 'machine-state/local.key' };
        await expect(files.target(protectedPath, 'person')).rejects.toMatchObject({ code: 'machine-state' });
        await expect(files.save(protectedPath, 'person')).rejects.toMatchObject({ code: 'machine-state' });
        expect(await readFile(join(folder, 'machine-state', 'local.key'), 'utf8')).toBe('secret');
    });
    test('copies an owned image to a project, leaving the attachment and no temporary files', async () => {
        const { folder, source, files, payload } = await fixture();
        expect(await files.target(payload, 'person')).toMatchObject({ folder, name: 'rabbit.png', exists: false, revision: null });
        expect(await files.save(payload, 'person')).toMatchObject({ path: join(folder, payload.path), size: IMAGE.length });
        expect(await readFile(join(folder, payload.path))).toEqual(IMAGE);
        expect(await readFile(source)).toEqual(IMAGE);
        expect(await readdir(join(folder, 'assets'))).toEqual(['rabbit.png']);
    });

    test('refuses ids of another chat and projects the client has not opened', async () => {
        const { files, payload } = await fixture();
        await expect(files.save({ ...payload, chatId: 'other' }, 'person')).rejects.toMatchObject({ code: 'outside-project' });
        await expect(files.save(payload, 'other')).rejects.toMatchObject({ code: 'outside-project' });
        await expect(files.save({ ...payload, attachmentId: 'other' }, 'person')).rejects.toMatchObject({ code: 'not-found' });
    });

    test('never overwrites through Save and only replaces the checked version', async () => {
        const { folder, files, payload } = await fixture();
        const path = join(folder, payload.path);
        await writeFile(path, 'existing');
        const target = await files.target(payload, 'person');
        expect(target.exists).toBe(true);
        await expect(files.save(payload, 'person')).rejects.toMatchObject({ code: 'exists' });
        expect(await readFile(path, 'utf8')).toBe('existing');
        await files.save({ ...payload, replace: target.revision! }, 'person');
        expect(await readFile(path)).toEqual(IMAGE);
        await expect(files.save({ ...payload, replace: target.revision! }, 'person')).rejects.toMatchObject({ code: 'stale' });
    });

    test('a replacement does not write through hard links to another folder', async () => {
        const { home, folder, files, payload } = await fixture();
        const original = join(home, 'outside.png');
        await writeFile(original, 'original');
        await link(original, join(folder, payload.path));
        const target = await files.target(payload, 'person');
        await files.save({ ...payload, replace: target.revision! }, 'person');
        expect(await readFile(original, 'utf8')).toBe('original');
        expect(await readFile(join(folder, payload.path))).toEqual(IMAGE);
    });

    test('refuses traversal, symlink destinations and project state', async () => {
        const { home, folder, files, payload } = await fixture();
        await mkdir(join(folder, '.git'));
        await mkdir(join(folder, '.ruimte'));
        await symlink(home, join(folder, 'escape'));
        await symlink(join(home, 'attachment.png'), join(folder, 'linked.png'));
        for (const path of ['../outside.png', 'escape/outside.png', '.git/image.png', '.ruimte/project.json', 'linked.png', 'assets', '']) {
            await expect(files.save({ ...payload, path }, 'person')).rejects.toBeDefined();
        }
        expect(await readFile(join(home, 'attachment.png'))).toEqual(IMAGE);
        expect(await readdir(join(folder, 'assets'))).toEqual([]);
    });

    test('invalid or missing image bytes create no destination', async () => {
        const { folder, source, files, payload } = await fixture();
        await writeFile(source, 'not an image');
        await expect(files.save(payload, 'person')).rejects.toBeDefined();
        expect(await readdir(join(folder, 'assets'))).toEqual([]);
        await rm(source);
        await expect(files.save(payload, 'person')).rejects.toBeDefined();
        expect(await readdir(join(folder, 'assets'))).toEqual([]);
    });

    test('concurrent saves publish complete bytes once', async () => {
        const { folder, files, payload } = await fixture();
        const results = await Promise.allSettled([files.save(payload, 'person'), files.save(payload, 'person')]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(await readFile(join(folder, payload.path))).toEqual(IMAGE);
        expect(await readdir(join(folder, 'assets'))).toEqual(['rabbit.png']);
    });
});
