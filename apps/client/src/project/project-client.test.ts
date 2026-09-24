import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type {
    EventMap,
    EventType,
    ProjectCanvasView,
    ProjectContent,
    ProjectDocument,
    ProjectLocal,
    ProjectPanels,
    ProjectSummary,
    ProjectView,
    RequestMap,
    RequestType
} from '@ruimte/contracts';
import { focusedCanvas, type CanvasState } from '../state/canvas';
import { useDocument } from '../state/document';
import { useFiles } from '../state/files';
import { useUi } from '../state/ui';
import { createWorkspaceStores, defaultWorkspaceStores } from '../state/workspace';
import type { WorkspaceStores } from '../state/workspace-stores';
import type { StoreApi } from 'zustand';
import { TransportError, type Transport, type TransportStatus } from '../transport/transport';
import { PanelsPort } from './panels-port';
import { rekeyLastProject } from './last-project';
import { setViewShared } from './views';
import { ProjectClient, type ProjectSink } from './project-client';
import { sessionNodesOf } from './project-sessions';

type Call = { type: RequestType; payload: unknown };

/* The canvas a workspace is editing, which with a project open is the editor of its active view. */
const canvasOf = (stores: WorkspaceStores): StoreApi<CanvasState> => {
    const active = stores.document.getState().activeViewId;
    return (active === null ? null : stores.canvases.peek(active)) ?? stores.canvases.blank;
};

const summary = (projectId: string, folder: string = '/repo'): ProjectSummary => ({
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
    version: 3,
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
    /* Set to keep a save on the wire, so a test can let something else reach the daemon first. */
    holdSave: Promise<void> | null = null;
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
                    views: { main: { camera: { center: { x: 5, y: 6 }, zoom: 1 }, focusedNodeId: null } },
                    panels: this.panels
                };
                return Promise.resolve({ summary: target, document: document(this.rev, this.views), local } as RequestMap[T]['result']);
            }
            case 'project.save': {
                const { baseRev } = payload as { baseRev: number };
                // The rev is read when the daemon gets to the write, not when the client sent it.
                const write = (): Promise<RequestMap[T]['result']> => {
                    if (baseRev !== this.rev) {
                        return Promise.reject(new TransportError('rev-conflict', 'stale'));
                    }
                    this.rev += 1;
                    return Promise.resolve({ rev: this.rev } as RequestMap[T]['result']);
                };
                return this.holdSave ? this.holdSave.then(write) : write();
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

    /* The link dropping or coming back, the way the pool's transport reports it. */
    setStatus(status: TransportStatus): void {
        this.status = status;
        for (const handler of this.statusHandlers) {
            handler(status);
        }
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

// Fake timers leave setImmediate alone. Each step runs the timers due in that millisecond, then every promise they started.
const tick = async (ms = 5): Promise<void> => {
    for (let i = 0; i < ms; i++) {
        jest.advanceTimersByTime(1);
        await new Promise((resolve) => setImmediate(resolve));
    }
};

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

/* The three calls `ProjectClient` makes on the storage it is given, over a map a test can read. */
const fakeStorage = (storage: Map<string, string>) => ({
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key)
});

/*
 * `open` is the project the client is built to open, the way a workspace is. A test that says nothing
 * gets the first project listed, so a test about saving or panels has a canvas without saying so.
 */
const setup = (
    options: {
        endpointId?: string;
        storage?: Map<string, string>;
        projects?: ProjectSummary[];
        open?: string | null;
        stores?: WorkspaceStores;
        window?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
    } = {}
) => {
    const stores = options.stores ?? defaultWorkspaceStores;
    stores.document.getState().load(null, null);
    useUi.setState({ panel: { open: false, kind: 'files' }, panelWidth: null });
    useFiles.setState({ projectId: null, tabs: [], active: null, expandedDirs: [] });
    const transport = new FakeTransport();
    if (options.projects) {
        transport.projects = options.projects;
    }
    const { sink, state } = makeSink();
    const storage = options.storage ?? new Map<string, string>();
    const endpointId = options.endpointId ?? 'daemon-a';
    const open = options.open === undefined ? (transport.projects[0]?.projectId ?? null) : options.open;
    const panels = new PanelsPort();
    /* What the client dropped its cache of, as kind and id, on the machine that project was opened on. */
    const forgotten: Array<{ endpointId: string; nodes: string[] }> = [];
    const client = new ProjectClient(transport, stores.canvases, stores.document, panels, sink, {
        saveDelayMs: 1,
        localDelayMs: 1,
        endpointId: () => endpointId,
        forgetSessions: (machine: string, views: readonly ProjectView[]) =>
            forgotten.push({ endpointId: machine, nodes: sessionNodesOf(views).map((node) => `${node.kind}:${node.id}`) }),
        storage: fakeStorage(storage),
        window: options.window ?? null
    });
    if (open !== null) {
        // On the first tick, so a test can still set up what the daemon answers.
        setTimeout(() => void client.openProject(open), 0);
    }
    const dispose = (): void => {
        client.dispose();
        panels.dispose();
    };
    return { transport, sink, state, client, storage, panels, stores, forgotten, dispose };
};

describe('ProjectClient', () => {
    test('opens its project, and loads its document and camera', async () => {
        const { transport, state, dispose } = setup();
        await tick();
        expect(transport.of('project.open')[0]?.payload).toEqual({ projectId: 'p1' });
        expect(state.current?.projectId).toBe('p1');
        expect(state.rev).toBe(3);
        expect(focusedCanvas().getState().viewCamera()).toEqual({ center: { x: 5, y: 6 }, zoom: 1 });
        dispose();
    });

    test('what this client had of a project wins over the machine, including its favicons', async () => {
        const storage = new Map<string, string>();
        const layout = {
            columns: [
                { size: 0.5, cells: [{ viewId: 'main', size: 1 }] },
                { size: 0.5, cells: [{ viewId: 'second', size: 1 }] }
            ],
            focus: { column: 1, cell: 0 }
        };
        const mine: ProjectLocal = {
            activeViewId: 'second',
            views: { second: { camera: { center: { x: 40, y: 50 }, zoom: 2 }, focusedNodeId: null }, gone: { camera: null, focusedNodeId: null } },
            panels: { panel: { open: true, kind: 'git' }, favicons: { 'browser-1': 'mine' } },
            layout
        };
        storage.set('ruimte.local', JSON.stringify({ 'daemon-a:p1': { at: 1, local: mine } }));
        const { transport, dispose } = setup({ storage, open: 'p1' });
        transport.views = [canvasView('main'), canvasView('second')];
        transport.panels = { panel: { open: false, kind: 'files' }, favicons: { 'browser-1': 'icon' } };
        await tick();

        expect(useDocument.getState().activeViewId).toBe('second');
        expect(useDocument.getState().layout).toEqual(layout);
        expect(useUi.getState().panel).toEqual({ open: true, kind: 'git' });
        // The main view has no camera on this client, so it keeps the machine's.
        expect(useDocument.getState().viewLocal.main).toEqual({ camera: { center: { x: 5, y: 6 }, zoom: 1 }, focusedNodeId: null });
        expect(useDocument.getState().viewLocal.gone).toBeUndefined();

        useUi.getState().togglePanel('files');
        await tick(10);
        const written = JSON.parse(storage.get('ruimte.local')!) as Record<string, { local: ProjectLocal }>;
        expect(written['daemon-a:p1']!.local.views.gone).toBeUndefined();
        expect(written['daemon-a:p1']!.local.panels?.favicons).toEqual({ 'browser-1': 'mine' });
        const sent = transport.of('project.save-local').at(-1)?.payload as { local: ProjectLocal };
        expect(sent.local.panels?.favicons).toBeUndefined();
        dispose();
    });

    test('a project this client never saw opens the way the machine had it, and the client keeps it from then on', async () => {
        const storage = new Map<string, string>();
        const { transport, dispose } = setup({ storage, open: 'p1' });
        transport.panels = { panel: { open: true, kind: 'files' } };
        await tick();
        expect(focusedCanvas().getState().viewCamera()).toEqual({ center: { x: 5, y: 6 }, zoom: 1 });
        expect(useUi.getState().panel).toEqual({ open: true, kind: 'files' });
        expect(storage.get('ruimte.local')).toBeUndefined();

        focusedCanvas().getState().setViewport({ w: 800, h: 600 });
        focusedCanvas().getState().panBy(10, 0);
        await tick(10);
        const written = JSON.parse(storage.get('ruimte.local')!) as Record<string, { local: ProjectLocal }>;
        expect(written['daemon-a:p1']!.local.views.main!.camera).toEqual({ center: { x: -5, y: 6 }, zoom: 1 });
        dispose();
    });

    test('a page on its way out writes where it stood before the pause runs out', async () => {
        const storage = new Map<string, string>();
        const listeners = new Map<string, () => void>();
        const host = {
            addEventListener: (type: string, listener: () => void) => void listeners.set(type, listener),
            removeEventListener: (type: string) => void listeners.delete(type)
        } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;
        const { transport, dispose } = setup({ storage, open: 'p1', window: host });
        await tick();
        // Synchronous from here on, so the pause of the local write cannot have run out.
        useUi.getState().togglePanel('git');
        expect(storage.get('ruimte.local')).toBeUndefined();

        listeners.get('pagehide')!();
        const written = JSON.parse(storage.get('ruimte.local')!) as Record<string, { local: ProjectLocal }>;
        expect(written['daemon-a:p1']!.local.panels?.panel).toEqual({ open: true, kind: 'git' });
        expect(transport.of('project.save-local')).toHaveLength(1);
        dispose();
        expect(listeners.has('pagehide')).toBe(false);
    });

    test('sharing a view is an edit that rides the next save, and the daemon is told which views travel', async () => {
        const { transport, dispose } = setup();
        await tick();
        expect(useDocument.getState().shared).toEqual([]);

        setViewShared('main', true);
        await tick(10);
        const save = transport.of('project.save')[0]?.payload as { shared: string[] };
        expect(save.shared).toEqual(['main']);
        expect(useDocument.getState().shared).toEqual(['main']);

        // And what a pull says about the folder outranks this screen.
        useDocument.getState().applyMerge(useDocument.getState().views, {}, [], {});
        expect(useDocument.getState().shared).toEqual([]);
        dispose();
    });

    test('a flag rides the next save, and taking the last one off still says so', async () => {
        const { transport, dispose } = setup();
        await tick();
        useDocument.getState().setFlags(['main'], 'red');
        await tick(10);
        expect((transport.of('project.save')[0]?.payload as { content: { flags?: unknown } }).content.flags).toEqual({ main: 'red' });

        useDocument.getState().setFlags(['main'], null);
        await tick(10);
        // An empty map and not a missing one: the daemon keeps the flags of a save that names none.
        expect((transport.of('project.save')[1]?.payload as { content: { flags?: unknown } }).content.flags).toEqual({});
        dispose();
    });

    test('an edit saves after the pause against the loaded rev, and a camera move only touches the local file', async () => {
        const { transport, state, dispose } = setup();
        await tick();
        focusedCanvas().getState().addNode('terminal', { x: 0, y: 0 });
        expect(state.dirty).toBe(true);
        await tick(10);
        const save = transport.of('project.save')[0]?.payload as { baseRev: number; content: { views: ProjectCanvasView[] } };
        expect(save.baseRev).toBe(3);
        expect(save.content.views[0]!.nodes).toHaveLength(1);
        expect(state.rev).toBe(4);
        expect(state.dirty).toBe(false);

        focusedCanvas().getState().setViewport({ w: 800, h: 600 });
        focusedCanvas().getState().panBy(10, 10);
        await tick(10);
        expect(transport.of('project.save')).toHaveLength(1);
        expect(transport.of('project.save-local').at(-1)?.payload).toMatchObject({
            projectId: 'p1',
            local: { activeViewId: 'main', views: { main: { camera: { center: { x: -5, y: -4 }, zoom: 1 } } } }
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

    test('a change from disk reaches a clean canvas, and a conflict waits behind the dialog when there are edits', async () => {
        const { transport, state, client, dispose } = setup();
        await tick();
        transport.emit('project.changed', {
            projectId: 'p1',
            document: document(9, [canvasView('main', [{ id: 'n', kind: 'browser', title: 'b', x: 0, y: 0, w: 10, h: 10 }])])
        });
        expect(state.rev).toBe(9);
        expect(focusedCanvas().getState().order).toEqual(['n']);
        expect(state.conflict).toBeNull();

        transport.rev = 9;
        focusedCanvas().getState().addNode('chat', { x: 0, y: 0 });
        // A rename of the project is nothing a merge takes in.
        transport.emit('project.changed', { projectId: 'p1', document: { ...document(10), name: 'renamed' } });
        expect(state.conflict?.rev).toBe(10);
        expect(focusedCanvas().getState().order).toHaveLength(2);

        await client.resolveConflict('theirs');
        expect(focusedCanvas().getState().order).toEqual([]);
        expect(state.rev).toBe(10);
        expect(state.conflict).toBeNull();
        dispose();
    });

    test('keeping mine after a conflict writes over the newer rev', async () => {
        const { transport, state, client, dispose } = setup();
        await tick();
        focusedCanvas().getState().addNode('chat', { x: 0, y: 0 });
        transport.rev = 12;
        // A rename is nothing a merge can take in, so this is the dialog and not the additive path.
        transport.emit('project.changed', { projectId: 'p1', document: { ...document(12), name: 'renamed' } });
        await tick(10);
        expect(state.conflict?.rev).toBe(12);
        await client.resolveConflict('mine');
        expect(transport.of('project.save').at(-1)?.payload).toMatchObject({ baseRev: 12 });
        expect(state.rev).toBe(13);
        expect(focusedCanvas().getState().order).toHaveLength(1);
        dispose();
    });

    test('a change from disk while the conflict is open replaces what the dialog offers instead of merging under it', async () => {
        const { transport, state, client, dispose } = setup();
        await tick();
        focusedCanvas().getState().addNode('chat', { x: 0, y: 0 });
        transport.rev = 12;
        transport.emit('project.changed', { projectId: 'p1', document: { ...document(12), name: 'renamed' } });
        await tick(10);
        expect(state.conflict?.rev).toBe(12);

        // A node an agent added would merge cleanly, and a merge would move the rev under the dialog.
        transport.rev = 13;
        transport.emit('project.changed', {
            projectId: 'p1',
            document: { ...document(13, [canvasView('main', [{ id: 'agent', kind: 'note', title: 'n', x: 0, y: 0, w: 10, h: 10 }])]), name: 'renamed' }
        });
        expect(state.conflict?.rev).toBe(13);
        expect(state.rev).toBe(3);
        expect(focusedCanvas().getState().nodes.agent).toBeUndefined();

        await client.resolveConflict('mine');
        expect(transport.of('project.save').at(-1)?.payload).toMatchObject({ baseRev: 13 });
        expect(state.rev).toBe(14);
        expect(state.dirty).toBe(false);
        dispose();
    });

    test('a node the daemon added lands on a canvas with unsaved edits, and the next save carries the new rev', async () => {
        const { transport, state, client, dispose } = setup();
        await tick();
        const mine = focusedCanvas().getState().addNode('chat', { x: 0, y: 0 })!;

        transport.rev = 4;
        transport.emit('project.changed', {
            projectId: 'p1',
            document: document(4, [canvasView('main', [{ id: 'agent', kind: 'note', title: 'from an agent', x: 0, y: 0, w: 10, h: 10 }]), canvasView('made')])
        });

        expect(state.conflict).toBeNull();
        expect(client.mergeRefusal).toBeNull();
        expect(focusedCanvas().getState().order).toEqual([mine, 'agent']);
        // A view an agent made is in the list, and did not take the cell the person is looking at.
        expect(useDocument.getState().views.map((view) => view.id)).toEqual(['main', 'made']);
        expect(useDocument.getState().activeViewId).toBe('main');
        expect(state.rev).toBe(4);

        await tick(10);
        const save = transport.of('project.save').at(-1)?.payload as { baseRev: number; content: { views: ProjectCanvasView[] } };
        expect(save.baseRev).toBe(4);
        expect(save.content.views[0]!.nodes.map((node) => node.id)).toEqual([mine, 'agent']);
        expect(state.rev).toBe(5);
        expect(state.dirty).toBe(false);
        dispose();
    });

    test('a save the daemon refuses is made again against the document that came in behind it', async () => {
        const { transport, state, dispose } = setup();
        await tick();
        let release = (): void => undefined;
        transport.holdSave = new Promise<void>((resolve) => {
            release = resolve;
        });
        const mine = focusedCanvas().getState().addNode('chat', { x: 0, y: 0 })!;
        await tick(10);
        expect(transport.of('project.save')).toHaveLength(1);

        // The agent's node reaches the file while this client's save is still on the wire.
        transport.rev = 4;
        transport.emit('project.changed', {
            projectId: 'p1',
            document: document(4, [canvasView('main', [{ id: 'agent', kind: 'note', title: 'from an agent', x: 0, y: 0, w: 10, h: 10 }])])
        });
        expect(state.conflict).toBeNull();

        transport.holdSave = null;
        release();
        await tick(20);

        const saves = transport.of('project.save').map((call) => (call.payload as { baseRev: number }).baseRev);
        expect(saves).toEqual([3, 4]);
        expect(state.conflict).toBeNull();
        expect(state.rev).toBe(5);
        expect(state.dirty).toBe(false);
        expect(focusedCanvas().getState().order).toEqual([mine, 'agent']);
        dispose();
    });

    test('a node moved and retitled in another client lands in the editor as a load, beside an edit here', async () => {
        const { transport, state, client, dispose } = setup();
        const note = (id: string, patch: Partial<ProjectCanvasView['nodes'][number]> = {}): ProjectCanvasView['nodes'][number] => ({
            id,
            kind: 'note',
            title: id,
            x: 0,
            y: 0,
            w: 10,
            h: 10,
            ...patch
        });
        transport.views = [canvasView('main', [note('a'), note('b')])];
        await tick();
        const editor = focusedCanvas();
        editor.getState().select(['b']);
        editor.getState().moveSelected(24, 0, true);
        const past = editor.getState().past;
        const camera = editor.getState().camera;

        transport.emit('project.changed', { projectId: 'p1', document: document(4, [canvasView('main', [note('a', { x: 300, title: 'Moved' }), note('b')])]) });

        expect(state.conflict).toBeNull();
        expect(client.mergeRefusal).toBeNull();
        expect(focusedCanvas()).toBe(editor);
        expect(editor.getState().nodes.a).toMatchObject({ x: 300, title: 'Moved' });
        expect(editor.getState().nodes.b).toMatchObject({ x: 24 });
        expect(editor.getState().past).toBe(past);
        expect(editor.getState().camera).toBe(camera);
        expect(editor.getState().selection).toEqual(['b']);
        expect(state.rev).toBe(4);

        await tick(10);
        const save = transport.of('project.save').at(-1)?.payload as { baseRev: number; content: { views: ProjectCanvasView[] } };
        expect(save.baseRev).toBe(4);
        expect(save.content.views[0]!.nodes.map((node) => [node.id, node.x])).toEqual([
            ['a', 300],
            ['b', 24]
        ]);
        dispose();
    });

    test('a node deleted in another client leaves a clean screen without an undo step or a load', async () => {
        const { transport, state, dispose } = setup();
        transport.views = [canvasView('main', [{ id: 'gone', kind: 'note', title: 'n', x: 0, y: 0, w: 10, h: 10 }])];
        await tick();
        const editor = focusedCanvas();
        editor.getState().select(['gone']);
        let loads = 0;
        const off = useDocument.subscribe((next, previous) => {
            loads += next.loading && !previous.loading ? 1 : 0;
        });

        transport.emit('project.changed', { projectId: 'p1', document: document(4, [canvasView('main')]) });

        off();
        expect(loads).toBe(0);
        expect(focusedCanvas()).toBe(editor);
        expect(editor.getState().order).toEqual([]);
        expect(editor.getState().selection).toEqual([]);
        expect(editor.getState().past).toEqual([]);
        expect(state.dirty).toBe(false);
        dispose();
    });

    test('a change to the list merges into a clean screen without swapping its editors out', async () => {
        const { transport, state, dispose } = setup();
        transport.views = [canvasView('main'), canvasView('notes')];
        await tick();
        const editor = focusedCanvas();

        transport.emit('project.changed', { projectId: 'p1', document: document(4, [canvasView('notes'), { ...canvasView('main'), name: 'Board' }]) });

        expect(useDocument.getState().views.map((view) => [view.id, 'name' in view ? view.name : null])).toEqual([
            ['notes', 'notes'],
            ['main', 'Board']
        ]);
        expect(focusedCanvas()).toBe(editor);
        expect(state.rev).toBe(4);
        expect(state.dirty).toBe(false);
        dispose();
    });

    test('leaving flushes edits and releases the project, and the stores keep what they hold for the next client', async () => {
        const { transport, state, client, dispose } = setup();
        await tick();
        focusedCanvas().getState().addText({ x: 0, y: 0 });
        await client.leave();
        expect(transport.of('project.save')).toHaveLength(1);
        // Released and not closed, so the project switched away from stays in the list, not under Recent.
        expect(transport.of('project.release').map((call) => call.payload)).toEqual([{ projectId: 'p1' }]);
        expect(transport.of('project.close')).toEqual([]);
        expect(state.current?.projectId).toBe('p1');
        expect(useDocument.getState().views.map((view) => view.id)).toEqual(['main']);
        dispose();
    });

    test('a client that left saves nothing more, even when the stores change under it', async () => {
        const { transport, client, dispose } = setup();
        await tick();
        await client.leave();
        focusedCanvas().getState().addText({ x: 0, y: 0 });
        await tick(20);
        expect(transport.of('project.save')).toHaveLength(0);
        dispose();
    });

    test('a client that has not opened its project yet leaves the project the stores still hold alone', async () => {
        const before = setup();
        await tick();
        before.dispose();
        const next = setup({ open: null });
        focusedCanvas().getState().addText({ x: 0, y: 0 });
        await tick(20);
        expect(next.transport.of('project.save')).toHaveLength(0);
        expect(next.transport.of('project.save-local')).toHaveLength(0);
        next.dispose();
    });

    test('the project reaches the stores in the tick the window is told', async () => {
        const stores = createWorkspaceStores();
        stores.document.getState().load(null, null);
        const transport = new FakeTransport();
        const { sink } = makeSink();
        const panels = new PanelsPort();
        const seen: Array<string[]> = [];
        const client = new ProjectClient(transport, stores.canvases, stores.document, panels, sink, {
            storage: fakeStorage(new Map()),
            window: null,
            onLoad: () => seen.push(stores.document.getState().views.map((view) => view.id))
        });
        await client.openProject('p1');
        // Before the load: what the window moves over is still the stores as they were.
        expect(seen).toEqual([[]]);
        expect(stores.document.getState().views.map((view) => view.id)).toEqual(['main']);
        client.dispose();
        panels.dispose();
    });

    test('the panels of the project that opens are applied, and the load itself writes nothing', async () => {
        const { transport, dispose } = setup();
        transport.panels = {
            panel: { open: true, kind: 'git' },
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

    test('closing leaves an empty canvas and no current project', async () => {
        const { state, client, dispose } = setup();
        await tick();
        focusedCanvas().getState().addNode('terminal', { x: 0, y: 0 });
        await client.closeProject();
        expect(state.current).toBeNull();
        expect(focusedCanvas().getState().order).toEqual([]);
        dispose();
    });

    test('closing offline clears the workspace without telling the daemon, and does not tell it later', async () => {
        const { state, client, transport, dispose } = setup();
        await tick();
        transport.setStatus('closed');
        focusedCanvas().getState().addNode('terminal', { x: 0, y: 0 });
        await client.closeProject();
        expect(state.current).toBeNull();
        expect(focusedCanvas().getState().order).toEqual([]);
        expect(transport.of('project.close')).toEqual([]);
        const opens = transport.of('project.open').length;
        transport.setStatus('open');
        await tick();
        expect(transport.of('project.open')).toHaveLength(opens);
        expect(transport.of('project.close')).toEqual([]);
        dispose();
    });

    test('closing asks the daemon to close the project and forgets what it cached for its sessions', async () => {
        const { client, transport, forgotten, dispose } = setup();
        await tick();
        const terminal = focusedCanvas().getState().addNode('terminal', { x: 0, y: 0 })!;
        const chat = focusedCanvas().getState().addNode('chat', { x: 0, y: 0 })!;
        focusedCanvas().getState().addNode('note', { x: 0, y: 0 });
        // A view of its own is a session as much as a node on the canvas, and it is not on screen.
        const view = useDocument.getState().addStandaloneView({ kind: 'terminal', name: 'Shell', node: {} });
        useDocument.getState().setActiveView('main');
        await client.closeProject();
        expect(transport.of('project.close')[0]?.payload).toEqual({ projectId: 'p1' });
        expect(forgotten).toEqual([{ endpointId: 'daemon-a', nodes: [`terminal:${terminal}`, `chat:${chat}`, `terminal:${view}`] }]);
        dispose();
    });

    test('closing is remembered here, so the row reads as closed whatever the machine still has open', async () => {
        const { client, storage, dispose } = setup();
        await tick();
        await client.closeProject();
        expect([...storage.keys()].some((key) => key.startsWith('ruimte.closedProject.'))).toBe(true);
        dispose();
    });

    test('leaving for another project keeps what it cached for the sessions of the one that left', async () => {
        const { client, forgotten, dispose } = setup();
        await tick();
        focusedCanvas().getState().addNode('terminal', { x: 0, y: 0 });
        await client.leave();
        expect(forgotten).toEqual([]);
        dispose();
    });
});

describe('a project with a drawing view', () => {
    test('a link that drops and comes back leaves the project, its editors and the grid where they were', async () => {
        const { transport, sink, state, stores, dispose } = setup();
        await tick();
        const editor = stores.canvases.peek('main');
        const layout = stores.document.getState().layout;
        let switched = false;
        const setSwitching = sink.setSwitching;
        sink.setSwitching = (switching) => {
            switched ||= switching;
            setSwitching(switching);
        };
        expect(editor).toBeDefined();

        transport.setStatus('closed');
        await tick();
        expect(state.current?.projectId).toBe('p1');
        transport.setStatus('connecting');
        transport.setStatus('open');
        await tick(10);

        // Asked again, since a restarted daemon holds nothing open, but nothing on screen was loaded again.
        expect(transport.of('project.open')).toHaveLength(2);
        expect(stores.canvases.peek('main')).toBe(editor);
        expect(stores.document.getState().layout).toBe(layout);
        expect(switched).toBe(false);
        expect(state.current?.projectId).toBe('p1');
        expect(state.rev).toBe(3);
        dispose();
    });

    test('says when the project is open again after the link came back', async () => {
        const { client, transport, dispose } = setup();
        await tick();
        let settled = false;
        await client.whenOpen();

        transport.setStatus('closed');
        transport.setStatus('open');
        const open = client.whenOpen().then(() => {
            settled = true;
        });
        expect(settled).toBe(false);
        await open;
        expect(transport.of('project.open')).toHaveLength(2);
        dispose();
    });

    test('an edit made while the link is down waits for it, and goes out against the loaded rev once it is back', async () => {
        const { transport, state, dispose } = setup();
        await tick();
        transport.setStatus('closed');
        focusedCanvas().getState().addNode('terminal', { x: 0, y: 0 });
        await tick(10);
        expect(transport.of('project.save')).toHaveLength(0);
        expect(transport.of('project.save-local')).toHaveLength(0);
        expect(state.dirty).toBe(true);

        transport.setStatus('open');
        await tick(10);
        expect(transport.of('project.save')).toHaveLength(1);
        expect(transport.of('project.save')[0]?.payload).toMatchObject({ baseRev: 3 });
        expect(state.dirty).toBe(false);
        expect(state.rev).toBe(4);
        dispose();
    });

    test('a file that moved on while the link was down comes in the way a change from disk does', async () => {
        const { transport, state, dispose } = setup();
        await tick();
        transport.setStatus('closed');
        transport.rev = 7;
        transport.views = [canvasView('main'), canvasView('second')];
        transport.setStatus('open');
        await tick(10);
        expect(state.rev).toBe(7);
        expect(useDocument.getState().views.map((view) => view.id)).toEqual(['main', 'second']);
        dispose();
    });

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

describe('the project the window had open last', () => {
    test('opening a project remembers it, whichever machine it is on', async () => {
        const storage = new Map<string, string>();
        const first = setup({ storage, endpointId: 'daemon-a' });
        await tick();
        first.dispose();
        const second = setup({ storage, endpointId: 'daemon-b', projects: [summary('q1', '/other')] });
        await tick();
        second.dispose();
        expect(JSON.parse(storage.get('ruimte.lastProject')!)).toEqual({ last: { endpointId: 'daemon-b', projectId: 'q1' } });
    });

    test('closing the project forgets it', async () => {
        const storage = new Map<string, string>();
        const { client, dispose } = setup({ storage, endpointId: 'daemon-a' });
        await tick();
        await client.closeProject();
        expect(JSON.parse(storage.get('ruimte.lastProject')!)).toEqual({ last: null });
        dispose();
    });

    test('an endpoint that moves onto its daemon id takes its project along, and the older shapes are read on the way', () => {
        const stored = { last: { endpointId: '10.0.0.4:4210', projectId: 'p7' }, byEndpoint: { '10.0.0.4:4210': 'p7', 'daemon-b': 'q1' } };
        const storage = new Map<string, string>([['ruimte.lastProject', JSON.stringify(stored)]]);
        rekeyLastProject('10.0.0.4:4210', 'daemon-x', fakeStorage(storage));
        expect(JSON.parse(storage.get('ruimte.lastProject')!)).toEqual({ last: { endpointId: 'daemon-x', projectId: 'p7' } });

        const other = new Map<string, string>([['ruimte.lastProject', JSON.stringify({ last: { endpointId: 'daemon-b', projectId: 'q1' } })]]);
        rekeyLastProject('10.0.0.4:4210', 'daemon-x', fakeStorage(other));
        expect(JSON.parse(other.get('ruimte.lastProject')!)).toEqual({ last: { endpointId: 'daemon-b', projectId: 'q1' } });
    });
});

/* Two clients on one project, the way two windows or two people have it. Each on its own stores. */
describe('the same project in two clients', () => {
    type Client = ReturnType<typeof setup>;

    /* The daemon between them. A save that lands for `from` goes to `to` as `project.changed`, the way `ProjectStore.save` sends it. */
    const relay = (from: Client, to: Client): void => {
        const request = from.transport.request.bind(from.transport);
        from.transport.request = (async (type: RequestType, payload: never) => {
            const result = await request(type, payload);
            if (type === 'project.save') {
                const { content } = payload as { content: ProjectContent };
                const { rev } = result as { rev: number };
                to.transport.rev = rev;
                // The fake names the project apart from its summary, so only the views travel.
                to.transport.emit('project.changed', { projectId: 'p1', document: document(rev, content.views) });
            }
            return result;
        }) as FakeTransport['request'];
    };

    const twoClients = async (): Promise<{ a: Client; b: Client }> => {
        const a = setup({ stores: createWorkspaceStores() });
        const b = setup({ stores: createWorkspaceStores() });
        a.transport.views = [canvasView('main'), canvasView('notes')];
        b.transport.views = [canvasView('main'), canvasView('notes')];
        relay(a, b);
        await tick();
        return { a, b };
    };

    const namesIn = (client: Client): Array<string | null> =>
        client.stores.document.getState().views.map((view) => ('name' in view ? (view.name ?? null) : null));

    test('a view renamed in one shows in the other at once', async () => {
        const { a, b } = await twoClients();

        a.stores.document.getState().renameView('notes', 'Ideas');
        await tick(10);

        expect(namesIn(b)).toEqual(['main', 'Ideas']);
        expect(b.state.rev).toBe(4);
        expect(b.state.conflict).toBeNull();
        a.dispose();
        b.dispose();
    });

    test('views put in another order in one stand in that order in the other', async () => {
        const { a, b } = await twoClients();

        a.stores.document.getState().moveView('notes', 0);
        await tick(10);

        expect(b.stores.document.getState().views.map((view) => view.id)).toEqual(['notes', 'main']);
        expect(b.state.conflict).toBeNull();
        a.dispose();
        b.dispose();
    });

    test('a view added in one is listed in the other, without taking its cell', async () => {
        const { a, b } = await twoClients();

        a.stores.document.getState().addCanvasView('Third');
        await tick(10);

        expect(namesIn(b)).toEqual(['main', 'notes', 'Third']);
        expect(b.stores.document.getState().activeViewId).toBe('main');
        a.dispose();
        b.dispose();
    });

    test('a rename that arrives while the other has a save on the wire merges, and that save does not write it away', async () => {
        const { a, b } = await twoClients();
        let release = (): void => undefined;
        b.transport.holdSave = new Promise<void>((resolve) => {
            release = resolve;
        });
        const mine = canvasOf(b.stores).getState().addNode('chat', { x: 0, y: 0 })!;
        await tick(10);

        a.stores.document.getState().renameView('notes', 'Ideas');
        a.stores.document.getState().moveView('notes', 0);
        await tick(10);
        expect(b.state.conflict).toBeNull();
        expect(namesIn(b)).toEqual(['Ideas', 'main']);

        b.transport.holdSave = null;
        release();
        await tick(20);

        const saved = b.transport.of('project.save').at(-1)?.payload as { baseRev: number; content: ProjectContent };
        expect(saved.content.views.map((view) => ('name' in view ? (view.name ?? null) : null))).toEqual(['Ideas', 'main']);
        expect((saved.content.views[1] as ProjectCanvasView).nodes.map((node) => node.id)).toEqual([mine]);
        expect(b.state.conflict).toBeNull();
        a.dispose();
        b.dispose();
    });

    test('a view deleted in one stays in the file, and in the other, until its undo is over', async () => {
        const { a, b } = await twoClients();

        a.stores.document.getState().trashView('notes');
        a.stores.document.getState().renameView('main', 'Board');
        await tick(10);
        const saved = a.transport.of('project.save').at(-1)?.payload as { content: ProjectContent };
        expect(saved.content.views.map((view) => view.id)).toEqual(['main', 'notes']);
        expect(namesIn(b)).toEqual(['Board', 'notes']);
        expect(namesIn(a)).toEqual(['Board']);

        a.stores.document.getState().purgeTrash();
        await tick(10);
        expect(namesIn(b)).toEqual(['Board']);
        a.dispose();
        b.dispose();
    });

    test('a change from the other merges in without bringing a deleted view back', async () => {
        const { a, b } = await twoClients();
        relay(b, a);

        a.stores.document.getState().trashView('notes');
        b.stores.document.getState().renameView('notes', 'Ideas');
        await tick(10);
        expect(namesIn(a)).toEqual(['main']);
        expect(a.state.conflict).toBeNull();

        a.stores.document.getState().restoreView('notes');
        expect(namesIn(a)).toEqual(['main', 'Ideas']);
        a.dispose();
        b.dispose();
    });
});

describe('a deleted view waiting on its undo', () => {
    test('goes for good when the page goes, and the save is sent before it is gone', async () => {
        const listeners = new Map<string, () => void>();
        const host = {
            addEventListener: (type: string, listener: () => void) => void listeners.set(type, listener),
            removeEventListener: (type: string) => void listeners.delete(type)
        } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;
        const { transport, stores, dispose } = setup({ open: 'p1', window: host, stores: createWorkspaceStores() });
        transport.views = [canvasView('main'), canvasView('notes')];
        await tick();
        stores.document.getState().trashView('notes');

        listeners.get('pagehide')!();
        expect(stores.document.getState().trashed).toEqual([]);
        const saved = transport.of('project.save').at(-1)?.payload as { content: ProjectContent };
        expect(saved.content.views.map((view) => view.id)).toEqual(['main']);
        dispose();
    });

    test('a page that goes before its save lands finishes the deletion on the next open', async () => {
        const storage = new Map<string, string>();
        const listeners = new Map<string, () => void>();
        const host = {
            addEventListener: (type: string, listener: () => void) => void listeners.set(type, listener),
            removeEventListener: (type: string) => void listeners.delete(type)
        } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;
        const first = setup({ storage, open: 'p1', window: host, stores: createWorkspaceStores() });
        first.transport.views = [canvasView('main'), canvasView('notes')];
        await tick();
        first.stores.document.getState().trashView('notes');
        first.transport.holdSave = new Promise(() => undefined);
        listeners.get('pagehide')!();
        await tick();
        first.dispose();

        const second = setup({ storage, open: 'p1', stores: createWorkspaceStores() });
        second.transport.views = [canvasView('main'), canvasView('notes')];
        await tick(10);
        expect(second.stores.document.getState().views.map((view) => view.id)).toEqual(['main']);
        const saved = second.transport.of('project.save').at(-1)?.payload as { content: ProjectContent };
        expect(saved.content.views.map((view) => view.id)).toEqual(['main']);
        expect([...storage.keys()].some((key) => key.startsWith('ruimte.deletedViews.'))).toBe(false);
        second.dispose();
    });

    test('an undo forgets the deletion, so the next open keeps the view', async () => {
        const storage = new Map<string, string>();
        const { transport, stores, dispose } = setup({ storage, open: 'p1', stores: createWorkspaceStores() });
        transport.views = [canvasView('main'), canvasView('notes')];
        await tick();
        stores.document.getState().trashView('notes');
        expect([...storage.keys()].some((key) => key.startsWith('ruimte.deletedViews.'))).toBe(true);

        stores.document.getState().restoreView('notes');
        expect([...storage.keys()].some((key) => key.startsWith('ruimte.deletedViews.'))).toBe(false);
        dispose();
    });

    test('goes for good before the project is left', async () => {
        const { transport, stores, client, dispose } = setup({ open: 'p1', stores: createWorkspaceStores() });
        transport.views = [canvasView('main'), canvasView('notes')];
        await tick();
        stores.document.getState().trashView('notes');

        await client.leave();
        const saved = transport.of('project.save').at(-1)?.payload as { content: ProjectContent };
        expect(saved.content.views.map((view) => view.id)).toEqual(['main']);
        dispose();
    });
});
