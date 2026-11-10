import { describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CanvasHost } from '../canvas/host.ts';
import { initRepo } from '../git/test-repo.ts';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';

async function call(host: CanvasHost): Promise<string[]> {
    return (await toolAnswer('project_ignored', {}, toolCall('chat-1', host))).lines;
}

function hostIn(folder: string): CanvasHost {
    return { projects: { locate: (id: string) => ({ projectId: 'p', folder, canvasId: 'c', id }) } } as unknown as CanvasHost;
}

describe('project_ignored', () => {
    test('lists the files git ignores in the project, links apart, and refuses a folder outside a repository', async () => {
        const folder = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-ignored-tool-')));
        const outside = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-ignored-none-')));

        try {
            await initRepo(folder, { '.gitignore': '.env\nlatest\n' });
            await writeFile(join(folder, '.env'), 'KEY=1\n');
            await symlink(join(folder, '.env'), join(folder, 'latest'));

            expect(await call(hostIn(folder))).toEqual([`root\t${folder}`, 'file\t.env\t6', 'link\tlatest']);
            expect((await call(hostIn(outside)))[0]).toStartWith('refused\tnot-a-repository\t');
        } finally {
            await rm(folder, { recursive: true, force: true });
            await rm(outside, { recursive: true, force: true });
        }
    });
});
