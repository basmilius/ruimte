import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeWatch } from '@adecore/agents/watch-test-helpers';
import { ProjectStore } from './project-store.ts';
import { documentPathInFolder, viewFilePathOf } from './project-files.ts';
import { writeDrawing } from './project-files.ts';

test('a process killed at each durable save boundary recovers on a fresh daemon', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruimte-save-crash-'));
    try {
        for (let boundary = 1; boundary <= 6; boundary++) {
            const folder = join(root, `${boundary}`, 'repo');
            const home = join(root, `${boundary}`, 'home');
            await mkdir(folder, { recursive: true });
            const initial = new ProjectStore(home, new FakeWatch());
            const opened = await initial.openProject({ folder });
            const projectId = opened.summary.projectId;
            const content = { name: 'repo', color: '#353e53', views: [{ kind: 'drawing' as const, id: 'sketch', name: 'Sketch' }] };
            await initial.save(projectId, 0, content);
            const path = documentPathInFolder(folder);
            await writeDrawing(viewFilePathOf(path, 'drawing', 'sketch', []), {
                version: 1,
                rev: 7,
                elements: [{ kind: 'rect', id: 'keep', x: 0, y: 0, w: 100, h: 60, stroke: 'ink', strokeWidth: 2, seed: 1 }]
            });
            const original = await readFile(viewFilePathOf(path, 'drawing', 'sketch', []));
            initial.closeAll();
            const program = `
                import { ProjectStore } from './apps/server/src/projects/project-store.ts';
                import { PROJECT_WRITE_IO } from './apps/server/src/projects/project-write.ts';
                import { FakeWatch } from ${JSON.stringify(import.meta.resolve('@adecore/agents/watch-test-helpers'))};
                let operations = 0;
                let armed = false;
                const stop = () => { if (armed && ++operations === ${boundary}) { process.kill(process.pid, 'SIGKILL'); } };
                const io = {
                    write: async (...args) => { await PROJECT_WRITE_IO.write(...args); stop(); },
                    remove: async (path) => { await PROJECT_WRITE_IO.remove(path); stop(); }
                };
                const projects = new ProjectStore(${JSON.stringify(home)}, new FakeWatch(), io);
                await projects.openProject({ projectId: ${JSON.stringify(projectId)} });
                armed = true;
                await projects.save(${JSON.stringify(projectId)}, 1, ${JSON.stringify(content)}, ['sketch']);
            `;
            const child = Bun.spawn(['bun', '--conditions=source', '--eval', program], { stdout: 'pipe', stderr: 'pipe' });
            try {
                const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
                expect(stderr).toBe('');
                expect(code).not.toBe(0);
            } finally {
                child.kill();
                await child.exited;
            }
            const restarted = new ProjectStore(home, new FakeWatch());
            try {
                const recovered = await restarted.openProject({ projectId });
                expect(recovered.document.rev).toBe(2);
                expect(recovered.document.shared).toEqual(['sketch']);
                expect(await readFile(viewFilePathOf(path, 'drawing', 'sketch', ['sketch']))).toEqual(original);
            } finally {
                restarted.closeAll();
            }
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
