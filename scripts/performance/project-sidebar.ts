import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectLinks } from '../../apps/server/src/projects/project-file-test-helpers';
import { ProjectStore } from '../../apps/server/src/projects/project-store';

const count = Number(process.env.BENCH_PROJECTS ?? 20);
const viewsPerProject = Number(process.env.BENCH_VIEWS ?? 100);
const runs = Number(process.env.BENCH_RUNS ?? 9);
const root = await mkdtemp(join(tmpdir(), 'ruimte-sidebar-store-'));
const home = join(root, 'home');
const seed = new ProjectStore(home, projectLinks());
let store: ProjectStore | undefined;
try {
    for (let project = 0; project < count; project++) {
        const opened = await seed.openProject({ folder: join(root, `project-${project}`), createFolder: true });
        await seed.save(opened.summary.projectId, opened.document.rev, {
            name: `Project ${project}`,
            color: 'blue',
            views: Array.from({ length: viewsPerProject }, (_, index) => ({
                id: `view-${project}-${index}`,
                name: `View ${index}`,
                kind: 'browser',
                url: 'https://example.com'
            }))
        });
        seed.release(opened.summary.projectId);
    }
    seed.closeAll();
    store = new ProjectStore(home, projectLinks());
    const warming = performance.now();
    await store.warmIndex();
    const warmIndexMs = performance.now() - warming;
    const samples = [];
    for (let run = 0; run < runs; run++) {
        const started = performance.now();
        const result = await store.sidebar();
        samples.push(performance.now() - started);
        if (result.projects.length !== count || result.projects.some((project) => project.views?.length !== viewsPerProject)) {
            throw new Error('Project sidebar lost projects or views');
        }
    }
    console.log(JSON.stringify({ benchmark: 'project-sidebar-store', count, viewsPerProject, runs, warmIndexMs, samples }, null, 2));
} finally {
    seed.closeAll();
    store?.closeAll();
    await rm(root, { recursive: true, force: true });
}
