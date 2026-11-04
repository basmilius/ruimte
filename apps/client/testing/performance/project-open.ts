import { PanelsPort } from '../../src/project/panels-port';
import { ProjectClient, type ProjectSink } from '../../src/project/project-client';
import { createWorkspaceStores } from '../../src/state/workspace';
import type { Transport } from '../../src/transport/transport';

const latency = Number(process.env.BENCH_LATENCY ?? 50);
const samples = [];
for (let i = 0; i < 11; i++) {
    const stores = createWorkspaceStores();
    const panels = new PanelsPort();
    const summary = {
        projectId: 'benchmark',
        name: 'Benchmark',
        folder: '/benchmark',
        color: '#000',
        lastOpenedAt: 0,
        available: true,
        icon: { kind: 'initial', value: 'B' },
        nameSource: 'chosen'
    };
    const state = { current: null, rev: 0, chosenIcon: null, dirty: false, conflict: null } as ReturnType<ProjectSink['getState']>;
    const sink: ProjectSink = {
        getState: () => state,
        setCurrent: (current, rev) => Object.assign(state, { current, rev }),
        setRev: () => {},
        setChosenIcon: () => {},
        setSummary: () => {},
        setDirty: () => {},
        setConflict: () => {},
        setError: () => {},
        setSwitching: () => {},
        setProjects: () => {},
        patchProject: () => {}
    };
    const transport = {
        status: 'open',
        on: () => () => {},
        subscribeStatus: () => () => {},
        request: async (type: string) => {
            await Bun.sleep(latency);
            if (type === 'project.open') {
                return { summary, document: { version: 3, rev: 1, name: 'Benchmark', color: '#000', views: [] }, local: { activeViewId: null, views: {} } };
            }
            return { projects: [summary] };
        }
    } as unknown as Transport;
    const client = new ProjectClient(transport, stores.canvases, stores.document, panels, sink, {
        storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        window: null,
        nextFrame: null
    });
    try {
        const started = performance.now();
        await client.openProject('benchmark');
        samples.push(performance.now() - started);
        if (state.current?.projectId !== 'benchmark') {
            throw new Error('Project did not open');
        }
    } finally {
        await Bun.sleep(latency * 2);
        client.dispose();
        panels.dispose();
    }
}
console.log(JSON.stringify({ benchmark: 'project-open', latency, samples }, null, 2));
