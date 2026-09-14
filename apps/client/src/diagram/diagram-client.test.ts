import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DiagramDocument, DiagramNode, EventMap, EventType, ProjectDocument, ProjectSummary, RequestMap, RequestType } from '@ruimte/contracts';
import type { DiagramState } from '@/state/diagram';
import { createWorkspaceStores } from '@/state/workspace';
import { TransportError, type Transport, type TransportStatus } from '@/transport/transport';
import { DiagramClient } from './diagram-client';

type Call = { type: RequestType; payload: unknown };

/*
 * A workspace of the test's own: its registries and the document and project stores over them. The
 * stores every module makes for the first workspace are shared by every test file in the process, and
 * a document store reads cameras through the registries it was built with, so a diagram loaded there
 * would depend on what other files did to those registries.
 */
const stores = createWorkspaceStores();
const diagrams = stores.diagrams;
const useDocument = stores.document;
const useProject = stores.project;

/* The diagram the client has open, or the blank one when it closed the last one. */
const diagram = (): DiagramState => (diagrams.live()[0]?.[1] ?? diagrams.blank).getState();

/* One named editor, for the tests where more than one diagram is on screen at a time. */
const editorOf = (viewId: string) => diagrams.peek(viewId) ?? diagrams.blank;

const node = (id: string): DiagramNode => ({ id, label: id });

const doc = (rev: number, ...nodes: DiagramNode[]): DiagramDocument => ({
    version: 1,
    rev,
    meta: { title: '', direction: 'right' },
    nodes,
    groups: [],
    edges: []
});

/* The one edit a diagram takes today: its content replaced, which is what dragging a node will do. */
const addNode = (state: DiagramState, added: DiagramNode): void => state.replaceContent({ ...state.content, nodes: [...state.content.nodes, added] });

const summary: ProjectSummary = {
    projectId: 'p1',
    name: 'p',
    color: '#000',
    folder: '/repo',
    lastOpenedAt: 0,
    available: true,
    icon: { kind: 'initial', value: 'P' },
    nameSource: 'chosen'
};

const project = (): ProjectDocument => ({
    version: 2,
    rev: 1,
    name: 'p',
    color: '#000',
    views: [
        { kind: 'canvas', id: 'main', name: 'Canvas', nodes: [], texts: [], edges: [], layouts: [] },
        { kind: 'diagram', id: 'view-1', name: 'Sketch' },
        { kind: 'diagram', id: 'view-2', name: 'Plan' }
    ]
});

class FakeTransport implements Transport {
    status: TransportStatus = 'open';
    readonly calls: Call[] = [];
    document: DiagramDocument = doc(5, node('a'));
    /* Set to refuse the next save the way the daemon refuses a stale rev. */
    conflictOnSave = false;
    /* A restarted daemon: it knows no rev for the diagram until it is opened again. */
    forgotten = false;
    private readonly eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        this.calls.push({ type, payload });
        if (type === 'diagram.open') {
            this.forgotten = false;
            return Promise.resolve({ document: this.document } as RequestMap[T]['result']);
        }
        if (type === 'diagram.save') {
            if (this.conflictOnSave || this.forgotten) {
                return Promise.reject(new TransportError('rev-conflict', 'stale'));
            }
            const { baseRev } = payload as { baseRev: number };
            return Promise.resolve({ rev: baseRev + 1 } as RequestMap[T]['result']);
        }
        return Promise.resolve({} as RequestMap[T]['result']);
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

    /* The socket dropping and coming back, which is what a restarted daemon looks like from here. */
    reconnect(): void {
        for (const handler of this.statusHandlers) {
            handler('closed');
            handler('open');
        }
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

const tick = (ms = 5): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let transport: FakeTransport;
let client: DiagramClient;
let flushes: number;

const setup = (): void => {
    diagrams.keep([]);
    useProject.getState().setCurrent(summary, 1, 'daemon-a');
    useDocument.getState().load(project(), {
        activeViewId: 'main',
        views: { 'view-1': { camera: { center: { x: 3, y: 4 }, zoom: 2 }, focusedNodeId: null } }
    });
    transport = new FakeTransport();
    flushes = 0;
    client = new DiagramClient(transport, diagrams, useDocument, useProject, {
        saveDelayMs: 1,
        window: null,
        document: null,
        flushProject: () => {
            flushes += 1;
            return Promise.resolve();
        }
    });
};

beforeEach(setup);

// A client that outlives its test would keep saving into the next one.
afterEach(() => client.dispose());

describe('DiagramClient', () => {
    test('a diagram coming up is opened, loaded and given the camera this machine remembers', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        expect(transport.of('diagram.open')[0]?.payload).toEqual({ projectId: 'p1', viewId: 'view-1' });
        // The project file is written first, or the daemon would not know the view yet.
        expect(flushes).toBe(1);
        expect(diagram().content.nodes.map((entry) => entry.id)).toEqual(['a']);
        expect(diagram().rev).toBe(5);
        // Nothing has measured the diagram yet, so the camera waits and is handed back as it came.
        expect(diagram().viewCamera()).toEqual({ center: { x: 3, y: 4 }, zoom: 2 });
    });

    test('a page that gets the views before the project still opens the diagram', async () => {
        // What a reload does: the client is up, the document store fills, the project lands last.
        client.dispose();
        diagrams.keep([]);
        useProject.getState().setCurrent(null, 0, null);
        useDocument.getState().load(null, null);
        transport = new FakeTransport();
        client = new DiagramClient(transport, diagrams, useDocument, useProject, { saveDelayMs: 1, window: null, document: null });

        useProject.getState().setSwitching(true);
        useDocument.getState().load(project(), { activeViewId: 'view-1', views: {} });
        useProject.getState().setCurrent(summary, 1, 'daemon-a');
        useProject.getState().setSwitching(false);
        await tick();

        expect(transport.of('diagram.open')).toHaveLength(1);
        expect(diagram().content.nodes.map((entry) => entry.id)).toEqual(['a']);
    });

    test('an edit saves after the pause, against the rev it was loaded on', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        addNode(diagram(), node('b'));
        expect(diagram().dirty).toBe(true);
        await tick(20);
        expect(transport.of('diagram.save')).toHaveLength(1);
        expect(transport.of('diagram.save')[0]?.payload).toMatchObject({ projectId: 'p1', viewId: 'view-1', baseRev: 5 });
        expect(diagram().rev).toBe(6);
        expect(diagram().dirty).toBe(false);
    });

    test('edits made during a save ride the next one, never a second write at the same time', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        addNode(diagram(), node('b'));
        await tick(20);
        addNode(diagram(), node('c'));
        await tick(20);
        expect(transport.of('diagram.save').map((call) => (call.payload as { baseRev: number }).baseRev)).toEqual([5, 6]);
    });

    test('a save the daemon refuses waits for the file, and the banner gets it', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        transport.conflictOnSave = true;
        addNode(diagram(), node('b'));
        await tick(20);
        expect(diagram().dirty).toBe(true);
        expect(diagram().error).toBeNull();

        transport.emit('diagram.changed', { projectId: 'p1', viewId: 'view-1', document: doc(9, node('z')) });
        expect(diagram().conflict).toMatchObject({ rev: 9 });
        // Taking the file loads it and stops the diagram from being dirty.
        await client.resolveConflict('theirs');
        expect(diagram().content.nodes.map((entry) => entry.id)).toEqual(['z']);
        expect(diagram().rev).toBe(9);
    });

    test('a node dragged while an agent writes the diagram goes to the banner, and keeping mine writes the drag over their rev', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        diagram().moveNode('a', [300, 120], true);
        // The agent's write lands before the pause after the drag is over.
        transport.emit('diagram.changed', { projectId: 'p1', viewId: 'view-1', document: doc(8, node('a'), node('agent')) });
        expect(diagram().conflict).toMatchObject({ rev: 8 });
        await tick(20);
        // Nothing is written while the banner stands.
        expect(transport.of('diagram.save')).toHaveLength(0);

        await client.resolveConflict('mine');
        await tick(20);
        const saves = transport.of('diagram.save');
        expect(saves).toHaveLength(1);
        const written = saves[0]!.payload as { baseRev: number; content: { nodes: DiagramNode[] } };
        expect(written.baseRev).toBe(8);
        expect(written.content.nodes).toEqual([{ id: 'a', label: 'a', pos: [300, 120] }]);
        expect(diagram().rev).toBe(9);
        expect(diagram().conflict).toBeNull();
    });

    test('taking theirs after a drag drops the drag and the step back to it', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        diagram().moveNode('a', [300, 120], true);
        transport.emit('diagram.changed', { projectId: 'p1', viewId: 'view-1', document: doc(8, node('a')) });
        await client.resolveConflict('theirs');
        expect(diagram().content.nodes).toEqual([{ id: 'a', label: 'a' }]);
        expect(diagram().past).toHaveLength(0);
        await tick(20);
        expect(transport.of('diagram.save')).toHaveLength(0);
    });

    test('a change from disk with nothing unsaved is loaded in place', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        transport.emit('diagram.changed', { projectId: 'p1', viewId: 'view-1', document: doc(7, node('z')) });
        expect(diagram().conflict).toBeNull();
        expect(diagram().content.nodes.map((entry) => entry.id)).toEqual(['z']);
        expect(diagram().rev).toBe(7);
    });

    test('a change for another diagram is not this one', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        transport.emit('diagram.changed', { projectId: 'p1', viewId: 'view-2', document: doc(7, node('z')) });
        expect(diagram().content.nodes.map((entry) => entry.id)).toEqual(['a']);
    });

    test('switching views writes what is pending and closes the diagram behind it', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        addNode(diagram(), node('b'));
        useDocument.getState().setActiveView('main');
        await tick(20);
        expect(transport.of('diagram.save')).toHaveLength(1);
        expect(transport.of('diagram.close')[0]?.payload).toEqual({ projectId: 'p1', viewId: 'view-1' });
        expect(diagram().viewId).toBeNull();
    });

    test('two diagrams side by side are both open, and each saves into its own file', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        useDocument.getState().splitFocused('right', 'view-2');
        await tick(20);
        expect(transport.of('diagram.open').map((call) => (call.payload as { viewId: string }).viewId)).toEqual(['view-1', 'view-2']);
        expect(transport.of('diagram.close')).toHaveLength(0);

        // Each cell edits its own editor, so an edit in one may never be written into the other's file.
        addNode(editorOf('view-1').getState(), node('b'));
        await tick(20);
        expect(transport.of('diagram.save').map((call) => (call.payload as { viewId: string }).viewId)).toEqual(['view-1']);
    });

    test('closing one cell closes that diagram and leaves the other open', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        useDocument.getState().splitFocused('right', 'view-2');
        await tick(20);
        useDocument.getState().closeCellAt({ column: 1, cell: 0 });
        await tick(20);
        expect(transport.of('diagram.close').map((call) => (call.payload as { viewId: string }).viewId)).toEqual(['view-2']);
        expect(editorOf('view-1').getState().viewId).toBe('view-1');
    });

    test('a diagram whose view is deleted is dropped without a save, so no orphan file comes back', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        addNode(diagram(), node('b'));
        useDocument.getState().deleteView('view-1');
        await tick(20);
        expect(transport.of('diagram.save')).toHaveLength(0);
        // The neighbor takes over, which is another diagram, so the store holds that one now.
        expect(diagram().viewId).toBe('view-2');
    });

    test('a daemon that forgot the diagram gets it again, and the work that was waiting lands', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        addNode(diagram(), node('b'));
        await tick(20);
        expect(diagram().rev).toBe(6);

        transport.document = doc(6, node('a'), node('b'));
        transport.forgotten = true;
        transport.reconnect();
        addNode(diagram(), node('c'));
        await tick(30);

        expect(transport.of('diagram.open')).toHaveLength(2);
        expect(diagram().dirty).toBe(false);
        expect(diagram().rev).toBe(7);
        const written = transport.of('diagram.save').at(-1)?.payload as { content: { nodes: DiagramNode[] } };
        expect(written.content.nodes.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    });

    test('the project being read again after a reconnect opens the diagram on the daemon', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        transport.reconnect();
        useDocument.getState().load(project(), { activeViewId: 'view-1', views: {} });
        await tick(20);
        expect(transport.of('diagram.open')).toHaveLength(2);
    });

    test('copying a view flushes both files first and asks the daemon for the copy', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        await client.copy('view-1', 'view-2');
        expect(transport.of('diagram.copy')[0]?.payload).toEqual({ projectId: 'p1', from: 'view-1', to: 'view-2' });
        expect(flushes).toBe(2);
    });
});
