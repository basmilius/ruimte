import { describe, expect, test } from 'bun:test';
import type {
    EventMap,
    EventType,
    ProjectCanvasView,
    ProjectDocument,
    ProjectLocal,
    ProjectPanels,
    ProjectSummary,
    RequestMap,
    RequestType
} from '@ruimte/contracts';
import { useCanvas } from '../state/canvas';
import { useDocument } from '../state/document';
import { useFiles } from '../state/files';
import { useUi } from '../state/ui';
import { createWorkspaceStores, defaultWorkspaceStores } from '../state/workspace';
import type { WorkspaceStores } from '../state/workspace-stores';
import { TransportError, type Transport, type TransportStatus } from '../transport/transport';
import { PanelsPort } from './panels-port';
import { rekeyLastProject } from './last-project';
import { ProjectClient, type ProjectSink } from './project-client';

type Call = { type: RequestType; payload: unknown };

const summary = (projectId: string, folder: string | null = null): ProjectSummary => ({
    projectId,
    name: projectId,
    color: '#000',
    folder,
    lastOpenedAt: 0,
    available: true,
    icon: { kind: 'initial', value: projectId[0]!.toUpperCase() },
    nameSource: 'chosen'
});

const canvasView = (id: string, nodes: ProjectCanvasView['nodes'] = []): ProjectCanvasView => ({
    kind: 'canvas',
    id,
    name: id,
    nodes,
    texts: [],
    edges: [],
    layouts: []
});

const document = (rev: number, views: ProjectDocument['views'] = [canvasView('main')]): ProjectDocument => ({
    version: 2,
    rev,
    name: 'p',
    color: '#000',
    views
});

class FakeTransport implements Transport {
    status: TransportStatus = 'open';
    readonly calls: Call[] = [];
    projects: ProjectSummary[] = [summary('p1', '/repo')];
    views: ProjectDocument['views'] = [canvasView('main')];
    rev = 3;
    panels: ProjectPanels | undefined = undefined;
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();
    private readonly eventHandlers = new Map<string, Set<(payload: unknown) => void>>();

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        this.calls.push({ type, payload });
        switch (type) {
            case 'project.list':
                return Promise.resolve({ projects: this.projects } as RequestMap[T]['result']);
            case 'project.open': {
                const wanted = (payload as { projectId?: string }).projectId;
                const target = this.projects.find((project) => project.projectId === wanted) ?? summary((payload as { name?: string }).name ?? 'new');
                const local: ProjectLocal = {
                    activeViewId: 'main',
                    views: { main: { camera: { x: 5, y: 6, zoom: 1 }, focusedNodeId: null } },
                    panels: this.panels
                };
                return Promise.resolve({ summary: target, document: document(this.rev, this.views), local } as RequestMap[T]['result']);
            }
            case 'project.save': {
                const { baseRev } = payload as { baseRev: number };
                if (baseRev !== this.rev) {
                    return Promise.reject(new TransportError('rev-conflict', 'stale'));
                }
                this.rev += 1;
                return Promise.resolve({ rev: this.rev } as RequestMap[T]['result']);
            }
            default:
                return Promise.resolve({} as RequestMap[T]['result']);
        }
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        let handlers = this.eventHandlers.get(event);
        if (!handlers) {
            handlers = new Set();
            this.eventHandlers.set(event, handlers);
        }
        handlers.add(handler as (payload: unknown) => void);
        return () => {
            handlers.delete(handler as (payload: unknown) => void);
        };
    }

    subscribeStatus(handler: (status: TransportStatus) => void): () => void {
        this.statusHandlers.add(handler);
        return () => {
            this.statusHandlers.delete(handler);
        };
    }

    emit<E extends EventType>(event: E, payload: EventMap[E]): void {
        for (const handler of this.eventHandlers.get(event) ?? []) {
            handler(payload);
        }
    }

    of(type: RequestType): Call[] {
        return this.calls.filter((call) => call.type === type);
    }
}

const makeSink = () => {
    const state: ReturnType<ProjectSink['getState']> & { projects: ProjectSummary[]; error: string | null; switching: boolean } = {
        current: null,
        rev: 0,
        chosenIcon: null,
        dirty: false,
        conflict: null,
        projects: [],
        error: null,
        switching: false
    };
    const sink: ProjectSink = {
        setProjects: (projects) => {
            state.projects = projects;
        },
        patchProject: (summary) => {
            state.projects = state.projects.map((project) => (project.projectId === summary.projectId ? summary : project));
        },
        setCurrent: (current, rev) => {
            state.current = current;
            state.rev = rev;
            state.dirty = false;
            state.conflict = null;
        },
        setRev: (rev) => {
            state.rev = rev;
        },
        setChosenIcon: (chosenIcon) => {
            state.chosenIcon = chosenIcon;
        },
        setSummary: (current) => {
            state.current = current;
        },
        setDirty: (dirty) => {
            state.dirty = dirty;
        },
        setConflict: (conflict) => {
            state.conflict = conflict;
        },
        setError: (error) => {
            state.error = error;
        },
        setSwitching: (switching) => {
            state.switching = switching;
        },
        getState: () => state
    };
    return { sink, state };
};

const tick = (ms = 5): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/* The three calls `ProjectClient` makes on the storage it is given, over a map a test can read. */
const fakeStorage = (storage: Map<string, string>) => ({
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key)
});

/*
 * `open` is which project this machine had open last, because that is the only thing a boot opens
 * now. A test that brings no storage of its own gets the first project listed, so a test about
 * saving or panels has a canvas without saying so; one that brings storage says it there instead.
 */
const setup = (
    options: { endpointId?: string; storage?: Map<string, string>; projects?: ProjectSummary[]; open?: string | null; stores?: WorkspaceStores } = {}
) => {
    const stores = options.stores ?? defaultWorkspaceStores;
    stores.document.getState().load(null, null);
    useUi.setState({ panel: { open: false, kind: 'files' }, preview: { open: false }, panelWidth: null, previewWidth: null });
    useFiles.setState({ projectId: null, tabs: [], active: null, expandedDirs: [] });
    const transport = new FakeTransport();
    if (options.projects) {
        transport.projects = options.projects;
    }
    const { sink, state } = makeSink();
    const storage = options.storage ?? new Map<string, string>();
    const endpointId = options.endpointId ?? 'daemon-a';
    const open = options.open === undefined ? (options.storage ? null : (transport.projects[0]?.projectId ?? null)) : options.open;
    if (open !== null) {
        const stored = JSON.parse(storage.get('ruimte.lastProject') ?? '{"last":null,"byEndpoint":{}}') as {
            last: unknown;
            byEndpoint: Record<string, string>;
        };
        storage.set('ruimte.lastProject', JSON.stringify({ ...stored, byEndpoint: { ...stored.byEndpoint, [endpointId]: open } }));
    }
    const panels = new PanelsPort();
    const client = new ProjectClient(transport, stores.canvas, stores.document, panels, sink, {
        saveDelayMs: 1,
        localDelayMs: 1,
        endpointId: () => endpointId,
        storage: fakeStorage(storage)
    });
    const dispose = (): void => {
        client.dispose();
        panels.dispose();
    };
    return { transport, sink, state, client, storage, panels, stores, dispose };
};

describe('ProjectClient', () => {
    test('boots into the project this machine had open, and loads its document and camera', async () => {
        const { transport, state, dispose } = setup();
        await tick();
        expect(transport.of('project.open')[0]?.payload).toEqual({ projectId: 'p1' });
        expect(state.current?.projectId).toBe('p1');
        expect(state.rev).toBe(3);
        expect(useCanvas.getState().camera).toEqual({ x: 5, y: 6, zoom: 1 });
        dispose();
    });

    test('a machine that has never had a project open boots into nothing, and opens nothing itself', async () => {
        const { transport, state, dispose } = setup({ open: null });
        await tick();
        expect(transport.of('project.open')).toHaveLength(0);
        expect(state.current).toBeNull();
        dispose();
    });

    test('a project this machine had open that the daemon no longer lists opens nothing', async () => {
        const { transport, state, dispose } = setup({ open: 'gone' });
        await tick();
        expect(transport.of('project.open')).toHaveLength(0);
        expect(state.current).toBeNull();
        dispose();
    });

    test('an edit saves after the pause against the loaded rev, and a camera move only touches the local file', async () => {
        const { transport, state, dispose } = setup();
        await tick();
        useCanvas.getState().addNode('terminal', { x: 0, y: 0 });
        expect(state.dirty).toBe(true);
        await tick(10);
        const save = transport.of('project.save')[0]?.payload as { baseRev: number; content: { views: ProjectCanvasView[] } };
        expect(save.baseRev).toBe(3);
        expect(save.content.views[0]!.nodes).toHaveLength(1);
        expect(state.rev).toBe(4);
        expect(state.dirty).toBe(false);

        useCanvas.getState().panBy(10, 10);
        await tick(10);
        expect(transport.of('project.save')).toHaveLength(1);
        expect(transport.of('project.save-local').at(-1)?.payload).toMatchObject({
            projectId: 'p1',
            local: { activeViewId: 'main', views: { main: { camera: { x: 15, y: 16, zoom: 1 } } } }
        });
        dispose();
    });

    test('switching views writes no edit, only which view this machine had open', async () => {
        const { transport, state, dispose } = setup();
        transport.views = [canvasView('main'), canvasView('second')];
        await tick();
        useDocument.getState().setActiveView('second');
        expect(state.dirty).toBe(false);
        await tick(10);
        expect(transport.of('project.save')).toHaveLength(0);
        expect(transport.of('project.save-local').at(-1)?.payload).toMatchObject({ local: { activeViewId: 'second' } });

        // Adding one is an edit, and the save carries both views.
        useDocument.getState().addCanvasView('Third');
        await tick(10);
        const save = transport.of('project.save').at(-1)?.payload as { content: { views: ProjectCanvasView[] } };
        expect(save.content.views.map((view) => view.name)).toEqual(['main', 'second', 'Third']);
        dispose();
    });

    test('a change from disk replaces a clean canvas, and waits behind a conflict when there are edits', async () => {
        const { transport, state, client, dispose } = setup();
        await tick();
        transport.emit('project.changed', {
            projectId: 'p1',
            document: document(9, [canvasView('main', [{ id: 'n', kind: 'browser', title: 'b', x: 0, y: 0, w: 10, h: 10 }])])
        });
        expect(state.rev).toBe(9);
        expect(useCanvas.getState().order).toEqual(['n']);
        expect(state.conflict).toBeNull();

        transport.rev = 9;
        useCanvas.getState().addNode('chat', { x: 0, y: 0 });
        transport.emit('project.changed', { projectId: 'p1', document: document(10) });
        expect(state.conflict?.rev).toBe(10);
        expect(useCanvas.getState().order).toHaveLength(2);

        await client.resolveConflict('theirs');
        expect(useCanvas.getState().order).toEqual([]);
        expect(state.rev).toBe(10);
        expect(state.conflict).toBeNull();
        dispose();
    });

    test('keeping mine after a conflict writes over the newer rev', async () => {
        const { transport, state, client, dispose } = setup();
        await tick();
        useCanvas.getState().addNode('chat', { x: 0, y: 0 });
        transport.rev = 12;
        transport.emit('project.changed', { projectId: 'p1', document: document(12) });
        await tick(10);
        expect(state.conflict?.rev).toBe(12);
        await client.resolveConflict('mine');
        expect(transport.of('project.save').at(-1)?.payload).toMatchObject({ baseRev: 12 });
        expect(state.rev).toBe(13);
        expect(useCanvas.getState().order).toHaveLength(1);
        dispose();
    });

    test('switching projects flushes edits, lets go of the old one and remembers the new one', async () => {
        const { transport, state, client, storage, dispose } = setup();
        await tick();
        transport.projects = [summary('p1', '/repo'), summary('p2')];
        useCanvas.getState().addText({ x: 0, y: 0 });
        await client.openProject('p2');
        expect(transport.of('project.save')).toHaveLength(1);
        // Released and not closed: the project switched away from stays in the list, not under Recent.
        expect(transport.of('project.release').map((call) => call.payload)).toEqual([{ projectId: 'p1' }]);
        expect(transport.of('project.close')).toEqual([]);
        expect(state.current?.projectId).toBe('p2');
        expect(JSON.parse(storage.get('ruimte.lastProject')!)).toEqual({ last: { endpointId: 'daemon-a', projectId: 'p2' }, byEndpoint: { 'daemon-a': 'p2' } });
        dispose();
    });

    test('the panels of the project that opens are applied, and the load itself writes nothing', async () => {
        const { transport, dispose } = setup();
        transport.panels = {
            panel: { open: true, kind: 'git' },
            preview: { open: true },
            panelWidth: 420,
            tabs: [{ path: '/repo/readme.md', pinned: true }],
            activeTab: '/repo/readme.md',
            expandedDirs: ['src/']
        };
        await tick(10);
        expect(useUi.getState().panel).toEqual({ open: true, kind: 'git' });
        expect(useUi.getState().panelWidth).toBe(420);
        expect(useFiles.getState().active).toBe('/repo/readme.md');
        expect(useFiles.getState().expandedDirs).toEqual(['src/']);
        expect(transport.of('project.save-local')).toHaveLength(0);
        dispose();
    });

    test('a panel that opens lands in the local file after the pause, next to the camera', async () => {
        const { transport, dispose } = setup();
        await tick();
        useUi.getState().togglePanel('files');
        useFiles.getState().setExpandedDirs(['src/', 'src/state/']);
        await tick(10);
        const local = transport.of('project.save-local').at(-1)?.payload as { projectId: string; local: ProjectLocal };
        expect(local.projectId).toBe('p1');
        expect(local.local.panels?.panel).toEqual({ open: true, kind: 'files' });
        expect(local.local.panels?.expandedDirs).toEqual(['src/', 'src/state/']);
        dispose();
    });

    test('another project brings its own panels, and the one that leaves takes its state with it', async () => {
        const { transport, client, dispose } = setup();
        await tick();
        transport.projects = [summary('p1', '/repo'), summary('p2')];
        useUi.getState().togglePanel('git');
        transport.panels = undefined;
        await client.openProject('p2');
        // The pause had not run out, so the panel of the project that left is written on the way out.
        const written = transport.of('project.save-local').at(-1)?.payload as { projectId: string; local: ProjectLocal };
        expect(written).toMatchObject({ projectId: 'p1' });
        expect(written.local.panels?.panel).toEqual({ open: true, kind: 'git' });
        expect(useUi.getState().panel).toEqual({ open: false, kind: 'files' });
        dispose();
    });

    test('closing leaves an empty canvas and no current project', async () => {
        const { state, client, dispose } = setup();
        await tick();
        useCanvas.getState().addNode('terminal', { x: 0, y: 0 });
        await client.closeProject();
        expect(state.current).toBeNull();
        expect(useCanvas.getState().order).toEqual([]);
        dispose();
    });
});

describe('a project with a drawing view', () => {
    test('the view survives a load and the save that follows it', async () => {
        const { transport, dispose } = setup();
        transport.views = [canvasView('main'), { kind: 'drawing', id: 'view-1', name: 'Sketch' }];
        await tick();
        expect(useDocument.getState().views.at(-1)).toEqual({ kind: 'drawing', id: 'view-1', name: 'Sketch' });

        useDocument.getState().renameView('view-1', 'Plan');
        await tick(20);
        const saved = transport.of('project.save').at(-1)?.payload as { content: { views: unknown[] } };
        expect(saved.content.views.at(-1)).toMatchObject({ kind: 'drawing', id: 'view-1', name: 'Plan' });
        dispose();
    });
});

describe('the project each machine had open', () => {
    test('a second daemon opens its own project and leaves the first one remembered', async () => {
        const storage = new Map<string, string>();
        const first = setup({ storage, endpointId: 'daemon-a', projects: [summary('p1', '/repo'), summary('p2')] });
        await tick();
        await first.client.openProject('p2');
        first.dispose();

        // The other machine has never had anything open, and p2 is not its to open anyway.
        const second = setup({ storage, endpointId: 'daemon-b', projects: [summary('q1', '/other')] });
        await tick();
        expect(second.state.current).toBeNull();
        await second.client.openProject('q1');
        expect(second.state.current?.projectId).toBe('q1');
        second.dispose();

        const back = setup({ storage, endpointId: 'daemon-a', projects: [summary('p1', '/repo'), summary('p2')] });
        await tick();
        expect(back.state.current?.projectId).toBe('p2');
        back.dispose();
        // What the person looked at last is the machine they ended on, which is what a cold boot follows.
        expect(JSON.parse(storage.get('ruimte.lastProject')!)).toEqual({
            last: { endpointId: 'daemon-a', projectId: 'p2' },
            byEndpoint: { 'daemon-a': 'p2', 'daemon-b': 'q1' }
        });
    });

    test('closing a project forgets it on this machine only', async () => {
        const stored = { last: { endpointId: 'daemon-a', projectId: 'p1' }, byEndpoint: { 'daemon-a': 'p1', 'daemon-b': 'q1' } };
        const storage = new Map<string, string>([['ruimte.lastProject', JSON.stringify(stored)]]);
        const { client, dispose } = setup({ storage, endpointId: 'daemon-a' });
        await tick();
        await client.closeProject();
        expect(JSON.parse(storage.get('ruimte.lastProject')!)).toEqual({ last: null, byEndpoint: { 'daemon-b': 'q1' } });
        dispose();
    });

    test('the single project id this key used to hold belongs to the endpoint that is active', async () => {
        const storage = new Map<string, string>([['ruimte.lastProject', 'p2']]);
        const { state, dispose } = setup({ storage, endpointId: 'daemon-a', projects: [summary('p1', '/repo'), summary('p2')] });
        await tick();
        expect(state.current?.projectId).toBe('p2');
        expect(JSON.parse(storage.get('ruimte.lastProject')!)).toEqual({ last: { endpointId: 'daemon-a', projectId: 'p2' }, byEndpoint: { 'daemon-a': 'p2' } });
        dispose();
    });

    test('the record from before there was a last still says what each machine had open', async () => {
        const storage = new Map<string, string>([['ruimte.lastProject', JSON.stringify({ 'daemon-a': 'p2', 'daemon-b': 'q1' })]]);
        const { state, dispose } = setup({ storage, endpointId: 'daemon-a', projects: [summary('p1', '/repo'), summary('p2')] });
        await tick();
        expect(state.current?.projectId).toBe('p2');
        dispose();
    });

    test('an endpoint that moves onto its daemon id takes what it had open along', () => {
        const stored = { last: { endpointId: '10.0.0.4:4210', projectId: 'p7' }, byEndpoint: { '10.0.0.4:4210': 'p7', 'daemon-b': 'q1' } };
        const storage = new Map<string, string>([['ruimte.lastProject', JSON.stringify(stored)]]);
        rekeyLastProject('10.0.0.4:4210', 'daemon-x', fakeStorage(storage));
        expect(JSON.parse(storage.get('ruimte.lastProject')!)).toEqual({
            last: { endpointId: 'daemon-x', projectId: 'p7' },
            byEndpoint: { 'daemon-b': 'q1', 'daemon-x': 'p7' }
        });

        const legacy = new Map<string, string>([['ruimte.lastProject', 'p7']]);
        rekeyLastProject('10.0.0.4:4210', 'daemon-x', fakeStorage(legacy));
        expect(JSON.parse(legacy.get('ruimte.lastProject')!)).toEqual({
            last: { endpointId: 'daemon-x', projectId: 'p7' },
            byEndpoint: { 'daemon-x': 'p7' }
        });
    });
});

/*
 * What phase 6 is for: one client per workspace, each on its own daemon and its own stores. Nothing
 * here is about the wire, it is about the client no longer having one canvas to boot a project into.
 */
describe('two workspaces side by side', () => {
    test('each opens its own project on its own machine, into its own canvas', async () => {
        const storage = new Map<string, string>();
        const here = setup({ endpointId: 'daemon-a', stores: createWorkspaceStores(), storage, projects: [summary('p1', '/here')], open: 'p1' });
        const there = setup({ endpointId: 'daemon-b', stores: createWorkspaceStores(), storage, projects: [summary('q1', '/there')], open: 'q1' });
        await tick();

        expect(here.state.current?.projectId).toBe('p1');
        expect(there.state.current?.projectId).toBe('q1');
        expect(here.transport.of('project.open')[0]?.payload).toEqual({ projectId: 'p1' });
        expect(there.transport.of('project.open')[0]?.payload).toEqual({ projectId: 'q1' });
        here.dispose();
        there.dispose();
    });

    test('an edit in one saves to its own daemon and leaves the other alone', async () => {
        const storage = new Map<string, string>();
        const here = setup({ endpointId: 'daemon-a', stores: createWorkspaceStores(), storage, projects: [summary('p1', '/here')], open: 'p1' });
        const there = setup({ endpointId: 'daemon-b', stores: createWorkspaceStores(), storage, projects: [summary('q1', '/there')], open: 'q1' });
        await tick();

        here.stores.canvas.getState().addText({ x: 0, y: 0 });
        await tick(20);

        expect(here.transport.of('project.save')).toHaveLength(1);
        expect(there.transport.of('project.save')).toHaveLength(0);
        expect(there.stores.canvas.getState().texts).toEqual({});
        here.dispose();
        there.dispose();
    });

    test('a document that arrives on one machine never lands on the other canvas', async () => {
        const storage = new Map<string, string>();
        const here = setup({ endpointId: 'daemon-a', stores: createWorkspaceStores(), storage, projects: [summary('p1', '/here')], open: 'p1' });
        const there = setup({ endpointId: 'daemon-b', stores: createWorkspaceStores(), storage, projects: [summary('q1', '/there')], open: 'q1' });
        await tick();

        here.transport.emit('project.changed', { projectId: 'p1', document: document(9, [canvasView('main'), canvasView('notes')]) });
        await tick();

        expect(here.stores.document.getState().views.map((view) => view.id)).toEqual(['main', 'notes']);
        expect(there.stores.document.getState().views.map((view) => view.id)).toEqual(['main']);
        here.dispose();
        there.dispose();
    });
});
