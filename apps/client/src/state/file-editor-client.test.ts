import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type {
    DiagramDocument,
    DiagramNode,
    DrawingDocument,
    DrawingElement,
    ProjectDocument,
    ProjectSummary,
    RequestMap,
    RequestType
} from '@ruimte/contracts';
import { DiagramClient } from '@/clients/diagram/diagram-client';
import { DrawingClient } from '@/clients/drawing/drawing-client';
import type { DiagramState } from '@/state/diagram';
import type { DrawingState } from '@/state/drawing';
import type { EditorRegistry } from '@/state/editors';
import type { FileEditorClient, FileEditorClientOptions } from '@/state/file-editor-client';
import { createWorkspaceStores } from '@/state/workspace';
import type { WorkspaceStores } from '@/state/workspace-stores';
import { TransportError, type Transport, type TransportStatus } from '@/transport-api/transport';

type Call = { type: RequestType; payload: unknown };

type Client = Pick<FileEditorClient<never, never, never>, 'copy' | 'dispose' | 'flush' | 'resolveConflict' | 'resume'>;

/* What every file editor's state has, whatever it edits. */
interface EditorState {
    rev: number;
    viewId: string | null;
    dirty: boolean;
    loading: boolean;
    error: unknown;
    conflict: unknown;
    viewCamera(): unknown;
}

/* What differs between the file editors: the channel on the wire, the store, and what one edit is. */
interface Kind<S extends EditorState> {
    readonly name: 'drawing' | 'diagram';
    registry(stores: WorkspaceStores): EditorRegistry<S>;
    client(transport: Transport, stores: WorkspaceStores, options: FileEditorClientOptions): Client;
    document(rev: number, ...ids: string[]): unknown;
    add(state: S, id: string): void;
    /* An unsaved edit that a document without `a` clashes with, whatever the kind can rebase. */
    clash(state: S): void;
    ids(state: S): string[];
    written(content: unknown): string[];
}

function rect(id: string): DrawingElement {
    return { kind: 'rect', id, x: 0, y: 0, w: 100, h: 60, stroke: 'ink', strokeWidth: 2, seed: 1 };
}

function node(id: string): DiagramNode {
    return { id, label: id };
}

function diagramDocument(rev: number, ...nodes: DiagramNode[]): DiagramDocument {
    return {
        version: 1,
        rev,
        meta: { title: '', direction: 'right' },
        nodes,
        groups: [],
        edges: []
    };
}

const DRAWING: Kind<DrawingState> = {
    name: 'drawing',
    registry: (stores) => stores.drawings,
    client: (transport, stores, options) => new DrawingClient(transport, stores.drawings, stores.document, stores.project, options),
    document: (rev, ...ids): DrawingDocument => ({ version: 1, rev, elements: ids.map(rect) }),
    add: (state, id) => state.addElement(rect(id)),
    clash: (state) => state.updateElement('a', { x: 50 }),
    ids: (state) => state.elements.map((element) => element.id),
    written: (content) => (content as { elements: DrawingElement[] }).elements.map((element) => element.id)
};

const DIAGRAM: Kind<DiagramState> = {
    name: 'diagram',
    registry: (stores) => stores.diagrams,
    client: (transport, stores, options) => new DiagramClient(transport, stores.diagrams, stores.document, stores.project, options),
    document: (rev, ...ids) => diagramDocument(rev, ...ids.map(node)),
    add: (state, id) => state.replaceContent({ ...state.content, nodes: [...state.content.nodes, node(id)] }),
    clash: (state) => state.replaceContent({ ...state.content, nodes: [...state.content.nodes, node('b')] }),
    ids: (state) => state.content.nodes.map((entry) => entry.id),
    written: (content) => (content as { nodes: DiagramNode[] }).nodes.map((entry) => entry.id)
};

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

function project(kind: 'drawing' | 'diagram'): ProjectDocument {
    return {
        version: 3,
        rev: 1,
        name: 'p',
        color: '#000',
        views: [
            { kind: 'canvas', id: 'main', name: 'Canvas', nodes: [], texts: [], edges: [], layouts: [] },
            { kind, id: 'view-1', name: 'Sketch' },
            { kind, id: 'view-2', name: 'Plan' },
            { kind, id: 'view-3', name: 'Notes' }
        ]
    };
}

class FakeTransport implements Transport {
    status: TransportStatus = 'open';
    readonly calls: Call[] = [];
    /* Set to refuse the next save the way the daemon refuses a stale rev. */
    conflictOnSave = false;
    /* A restarted daemon: it knows no rev for the file until it is opened again. */
    forgotten = false;
    /* Set to refuse every save for a reason other than the rev, the way a full disk would. */
    failOnSave = false;
    /* Requests of one kind for one view that wait until the test lets them through. */
    private readonly gates = new Map<string, Promise<void>>();
    private readonly arrivals = new Map<string, (call: Call) => void>();
    private readonly eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();

    document: unknown;
    private readonly channel: string;

    constructor(channel: string, document: unknown) {
        this.channel = channel;
        this.document = document;
    }

    /* Holds every `action` request for one view until the function it hands back is called. */
    hold(action: 'open' | 'save', viewId: string): () => void {
        let release = (): void => undefined;
        this.gates.set(`${action}:${viewId}`, new Promise((resolve) => (release = resolve)));
        return () => {
            this.gates.delete(`${action}:${viewId}`);
            release();
        };
    }

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        const call = { type, payload };
        this.calls.push(call);
        const key = `${type.slice(this.channel.length + 1)}:${(payload as { viewId?: string }).viewId}`;
        this.arrivals.get(key)?.(call);
        this.arrivals.delete(key);
        const gate = this.gates.get(key);
        if (gate) {
            return gate.then(() => this.answer(type, payload));
        }
        return this.answer(type, payload);
    }

    next(action: 'open' | 'save' | 'close', viewId: string): Promise<Call> {
        return new Promise((resolve) => this.arrivals.set(`${action}:${viewId}`, resolve));
    }

    private answer<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        if (type === `${this.channel}.open`) {
            this.forgotten = false;
            return Promise.resolve({ document: this.document } as RequestMap[T]['result']);
        }
        if (type === `${this.channel}.save`) {
            if (this.conflictOnSave || this.forgotten) {
                return Promise.reject(new TransportError('rev-conflict', 'stale'));
            }
            if (this.failOnSave) {
                return Promise.reject(new TransportError('internal', 'disk full'));
            }
            const { baseRev } = payload as { baseRev: number };
            return Promise.resolve({ rev: baseRev + 1 } as RequestMap[T]['result']);
        }
        return Promise.resolve({} as RequestMap[T]['result']);
    }

    on(event: string, handler: (payload: never) => void): () => void {
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

    changed(viewId: string, document: unknown): void {
        for (const handler of this.eventHandlers.get(`${this.channel}.changed`) ?? []) {
            handler({ projectId: 'p1', viewId, document });
        }
    }

    of(action: string): Call[] {
        return this.calls.filter((call) => call.type === `${this.channel}.${action}`);
    }

    viewIdsOf(action: string): string[] {
        return this.of(action).map((call) => (call.payload as { viewId: string }).viewId);
    }
}

// Fake timers leave setImmediate alone: each step runs the timers due in that millisecond, then every promise they started.
async function tick(ms = 5): Promise<void> {
    for (let i = 0; i < ms; i++) {
        jest.advanceTimersByTime(1);
        await new Promise((resolve) => setImmediate(resolve));
    }
}

interface Harness<S> {
    readonly stores: WorkspaceStores;
    readonly transport: FakeTransport;
    readonly client: Client;
    readonly flushes: number;
    /* The file the client has open, or the blank one when it closed the last one. */
    current(): S;
    editorOf(viewId: string): S;
    loaded(viewId: string): Promise<void>;
    holdProject(): { entered: Promise<void>; release(): void };
}

/*
 * Every suite gets a workspace of its own. The stores every module makes for the first workspace are
 * shared by every test file in the process, so a client over those would see what other files left there.
 */
function harnessFor<S extends EditorState>(kind: Kind<S>): Harness<S> {
    const stores = createWorkspaceStores();
    const registry = kind.registry(stores);
    let transport: FakeTransport;
    let client: Client;
    let flushes = 0;
    let projectGate: { entered: ReturnType<typeof Promise.withResolvers<void>>; done: ReturnType<typeof Promise.withResolvers<void>> } | null = null;

    beforeEach(() => {
        jest.useFakeTimers();
        registry.keep([]);
        stores.project.getState().setCurrent(summary, 1, 'daemon-a');
        stores.document.getState().load(project(kind.name), {
            activeViewId: 'main',
            views: { 'view-1': { camera: { center: { x: 3, y: 4 }, zoom: 2 }, focusedNodeId: null } }
        });
        transport = new FakeTransport(kind.name, kind.document(5, 'a'));
        flushes = 0;
        projectGate = null;
        client = kind.client(transport, stores, {
            saveDelayMs: 1,
            window: null,
            document: null,
            flushProject: () => {
                flushes += 1;
                projectGate?.entered.resolve();
                return projectGate?.done.promise ?? Promise.resolve();
            }
        });
    });

    // A client that outlives its test would keep saving into the next one.
    afterEach(() => {
        client.dispose();
        jest.useRealTimers();
    });

    return {
        stores,
        get transport() {
            return transport;
        },
        get client() {
            return client;
        },
        get flushes() {
            return flushes;
        },
        current: () => (registry.live()[0]?.[1] ?? registry.blank).getState(),
        editorOf: (viewId) => (registry.peek(viewId) ?? registry.blank).getState(),
        loaded: (viewId) => {
            const editor = registry.of(viewId);
            const ready = (state: S): boolean => state.viewId === viewId && !state.loading;
            if (ready(editor.getState())) {
                return Promise.resolve();
            }
            return new Promise((resolve) => {
                const off = editor.subscribe((state) => {
                    if (ready(state)) {
                        off();
                        resolve();
                    }
                });
            });
        },
        holdProject: () => {
            const gate = { entered: Promise.withResolvers<void>(), done: Promise.withResolvers<void>() };
            projectGate = gate;
            return {
                entered: gate.entered.promise,
                release: () => {
                    projectGate = null;
                    gate.done.resolve();
                }
            };
        }
    };
}

function suite<S extends EditorState>(kind: Kind<S>): void {
    describe(`a ${kind.name} file`, () => {
        const harness = harnessFor(kind);
        const documents = (): WorkspaceStores['document'] => harness.stores.document;
        const open = async (): Promise<void> => {
            documents().getState().setActiveView('view-1');
            await tick();
        };

        test('coming up is opened, loaded and given the camera this machine remembers', async () => {
            const gate = harness.holdProject();
            const opened = harness.transport.next('open', 'view-1');
            documents().getState().setActiveView('view-1');
            await gate.entered;
            expect(harness.transport.of('open')).toEqual([]);
            gate.release();
            await opened;
            await harness.loaded('view-1');
            expect(harness.transport.of('open')[0]?.payload).toEqual({ projectId: 'p1', viewId: 'view-1' });
            // The project file is written first, or the daemon would not know the view yet.
            expect(harness.flushes).toBe(1);
            expect(kind.ids(harness.current())).toEqual(['a']);
            expect(harness.current().rev).toBe(5);
            // Nothing has measured the file yet, so the camera waits and is handed back as it came.
            expect(harness.current().viewCamera()).toEqual({ center: { x: 3, y: 4 }, zoom: 2 });
        });

        test('a page that gets the views before the project still opens it', async () => {
            // What a reload does: the client is up, the document store fills, the project lands last.
            harness.client.dispose();
            kind.registry(harness.stores).keep([]);
            harness.stores.project.getState().setCurrent(null, 0, null);
            documents().getState().load(null, null);
            const transport = new FakeTransport(kind.name, kind.document(5, 'a'));
            const client = kind.client(transport, harness.stores, { saveDelayMs: 1, window: null, document: null });

            harness.stores.project.getState().setSwitching(true);
            documents().getState().load(project(kind.name), { activeViewId: 'view-1', views: {} });
            harness.stores.project.getState().setCurrent(summary, 1, 'daemon-a');
            harness.stores.project.getState().setSwitching(false);
            await tick();

            expect(transport.of('open')).toHaveLength(1);
            expect(kind.ids(harness.current())).toEqual(['a']);
            client.dispose();
        });

        test('an edit saves after the pause, against the rev it was loaded on', async () => {
            await open();
            kind.add(harness.current(), 'b');
            expect(harness.current().dirty).toBe(true);
            await tick(20);
            expect(harness.transport.of('save')).toHaveLength(1);
            expect(harness.transport.of('save')[0]?.payload).toMatchObject({ projectId: 'p1', viewId: 'view-1', baseRev: 5 });
            expect(harness.current().rev).toBe(6);
            expect(harness.current().dirty).toBe(false);
        });

        test('edits made during a save ride the next one, never a second write at the same time', async () => {
            await open();
            const release = harness.transport.hold('save', 'view-1');
            try {
                kind.add(harness.current(), 'b');
                await tick(20);
                expect(harness.transport.of('save')).toHaveLength(1);
                kind.add(harness.current(), 'c');
                await tick(20);
                expect(harness.transport.of('save')).toHaveLength(1);
                release();
                await tick(20);
                const saves = harness.transport.of('save');
                expect(saves.map((call) => (call.payload as { baseRev: number }).baseRev)).toEqual([5, 6]);
                expect(saves.map((call) => kind.written((call.payload as { content: unknown }).content))).toEqual([
                    ['a', 'b'],
                    ['a', 'b', 'c']
                ]);
            } finally {
                release();
            }
        });

        test('a save the daemon refuses waits for the file, and the banner gets it', async () => {
            await open();
            harness.transport.conflictOnSave = true;
            kind.clash(harness.current());
            await tick(20);
            expect(harness.current().dirty).toBe(true);
            expect(harness.current().error).toBeNull();

            harness.transport.changed('view-1', kind.document(9, 'z'));
            expect(harness.current().conflict).toMatchObject({ rev: 9 });
            // Taking the file loads it and stops the editor from being dirty.
            await harness.client.resolveConflict('theirs');
            expect(kind.ids(harness.current())).toEqual(['z']);
            expect(harness.current().rev).toBe(9);
        });

        test('taking theirs drops the save the edit that caused the conflict still had waiting', async () => {
            await open();
            kind.clash(harness.current());
            // Their write lands before the pause after the edit is over.
            harness.transport.changed('view-1', kind.document(8, 'z'));
            expect(harness.current().conflict).toMatchObject({ rev: 8 });

            await harness.client.resolveConflict('theirs');
            expect(kind.ids(harness.current())).toEqual(['z']);
            await tick(20);

            expect(harness.transport.of('save')).toHaveLength(0);
            expect(harness.current().rev).toBe(8);
        });

        test('a change from disk with nothing unsaved is loaded in place', async () => {
            await open();
            harness.transport.changed('view-1', kind.document(7, 'z'));
            expect(harness.current().conflict).toBeNull();
            expect(kind.ids(harness.current())).toEqual(['z']);
            expect(harness.current().rev).toBe(7);
        });

        test('a change for another view is not this one', async () => {
            await open();
            harness.transport.changed('view-2', kind.document(7, 'z'));
            expect(kind.ids(harness.current())).toEqual(['a']);
        });

        test('switching views writes what is pending and closes the file behind it', async () => {
            await open();
            kind.add(harness.current(), 'b');
            documents().getState().setActiveView('main');
            await tick(20);
            expect(harness.transport.of('save')).toHaveLength(1);
            expect(harness.transport.of('close')[0]?.payload).toEqual({ projectId: 'p1', viewId: 'view-1' });
            expect(harness.current().viewId).toBeNull();
        });

        test('two side by side are both open, and each saves into its own file', async () => {
            await open();
            documents().getState().splitFocused('right', 'view-2');
            await tick(20);
            expect(harness.transport.viewIdsOf('open')).toEqual(['view-1', 'view-2']);
            expect(harness.transport.of('close')).toHaveLength(0);

            // Each cell edits its own editor, so an edit in one may never be written into the other's file.
            kind.add(harness.editorOf('view-1'), 'b');
            await tick(20);
            expect(harness.transport.viewIdsOf('save')).toEqual(['view-1']);
        });

        test('closing one cell closes that file and leaves the other open', async () => {
            await open();
            documents().getState().splitFocused('right', 'view-2');
            await tick(20);
            documents().getState().closeCellAt({ column: 1, cell: 0 });
            await tick(20);
            expect(harness.transport.viewIdsOf('close')).toEqual(['view-2']);
            expect(harness.editorOf('view-1').viewId).toBe('view-1');
        });

        test('a view that is deleted is dropped without a save, so no orphan file comes back', async () => {
            await open();
            kind.add(harness.current(), 'b');
            documents().getState().deleteView('view-1');
            await tick(20);
            expect(harness.transport.of('save')).toHaveLength(0);
            // The neighbor takes over, which is of the same kind, so the store holds that one now.
            expect(harness.current().viewId).toBe('view-2');
        });

        test('a view that is trashed writes what is pending, so an undo brings the last edit back', async () => {
            await open();
            kind.add(harness.current(), 'b');
            documents().getState().trashView('view-1');
            await tick(20);
            expect(harness.transport.viewIdsOf('save')).toEqual(['view-1']);
            expect(harness.transport.viewIdsOf('close')).toContain('view-1');
            // A project loaded again keeps what is still trashed, so the next test would start without the view.
            documents().getState().purgeTrash();
        });

        test('a daemon that forgot the file gets it again, and the work that was waiting lands', async () => {
            await open();
            kind.add(harness.current(), 'b');
            await tick(20);
            expect(harness.current().rev).toBe(6);

            harness.transport.document = kind.document(6, 'a', 'b');
            harness.transport.forgotten = true;
            harness.transport.reconnect();
            kind.add(harness.current(), 'c');
            await tick(30);

            expect(harness.transport.of('open')).toHaveLength(2);
            expect(harness.current().dirty).toBe(false);
            expect(harness.current().rev).toBe(7);
            const written = harness.transport.of('save').at(-1)?.payload as { content: unknown };
            expect(kind.written(written.content)).toEqual(['a', 'b', 'c']);
        });

        test('an edit made while the link is down waits, and a resume opens the file again and writes it', async () => {
            await open();
            harness.transport.status = 'closed';
            harness.transport.reconnect();
            kind.add(harness.current(), 'b');
            await tick(20);
            expect(harness.transport.of('save')).toHaveLength(0);
            expect(harness.current().dirty).toBe(true);

            harness.transport.status = 'open';
            await harness.client.resume();
            await tick(20);
            expect(harness.transport.of('open')).toHaveLength(2);
            expect(harness.transport.of('save')).toHaveLength(1);
            expect(harness.current().dirty).toBe(false);
        });

        test('a cell closed while the link is down keeps its edits, and the resume writes them before the file closes', async () => {
            await open();
            harness.transport.status = 'closed';
            harness.transport.reconnect();
            kind.add(harness.current(), 'b');
            documents().getState().setActiveView('main');
            await tick(20);
            expect(harness.transport.of('save')).toHaveLength(0);
            expect(harness.transport.of('close')).toHaveLength(0);
            expect(kind.ids(harness.editorOf('view-1'))).toEqual(['a', 'b']);

            harness.transport.status = 'open';
            const release = harness.transport.hold('save', 'view-1');
            const saving = harness.transport.next('save', 'view-1');
            const closed = harness.transport.next('close', 'view-1');
            const resumed = harness.client.resume();
            await saving;
            expect(harness.transport.of('close')).toEqual([]);
            release();
            await resumed;
            await closed;
            const saves = harness.transport.of('save');
            expect(saves).toHaveLength(1);
            expect(kind.written((saves[0]!.payload as { content: unknown }).content)).toEqual(['a', 'b']);
            expect(harness.transport.viewIdsOf('close')).toEqual(['view-1']);
            expect(harness.transport.calls.filter((call) => call.type.endsWith('.save') || call.type.endsWith('.close')).map((call) => call.type)).toEqual([
                `${kind.name}.save`,
                `${kind.name}.close`
            ]);
            expect(harness.editorOf('view-1').viewId).toBeNull();
        });

        test('a cell that comes back while its edits wait takes them up rather than loading the file over them', async () => {
            await open();
            harness.transport.status = 'closed';
            harness.transport.reconnect();
            kind.add(harness.current(), 'b');
            documents().getState().setActiveView('main');
            await tick(20);
            documents().getState().setActiveView('view-1');
            await tick(20);
            expect(harness.transport.of('open')).toHaveLength(1);
            expect(kind.ids(harness.editorOf('view-1'))).toEqual(['a', 'b']);

            harness.transport.status = 'open';
            await harness.client.resume();
            await tick(20);
            const saves = harness.transport.of('save');
            expect(saves).toHaveLength(1);
            expect(kind.written((saves[0]!.payload as { content: unknown }).content)).toEqual(['a', 'b']);
            expect(harness.transport.of('close')).toHaveLength(0);
        });

        test('a save refused on the way out keeps the edits until a later flush writes them', async () => {
            await open();
            harness.transport.failOnSave = true;
            kind.add(harness.current(), 'b');
            documents().getState().setActiveView('main');
            await tick(20);
            expect(harness.transport.of('save')).toHaveLength(1);
            expect(harness.transport.of('close')).toHaveLength(0);
            expect(harness.editorOf('view-1').dirty).toBe(true);

            harness.transport.failOnSave = false;
            await harness.client.flush();
            await tick(20);
            expect(harness.transport.of('save')).toHaveLength(2);
            expect(harness.transport.viewIdsOf('close')).toEqual(['view-1']);
            expect(harness.editorOf('view-1').viewId).toBeNull();
        });

        test('a view deleted while its edits wait off screen goes without a save', async () => {
            await open();
            harness.transport.status = 'closed';
            harness.transport.reconnect();
            kind.add(harness.current(), 'b');
            documents().getState().setActiveView('main');
            await tick(20);
            documents().getState().deleteView('view-1');
            await tick(20);
            expect(harness.transport.viewIdsOf('close')).toEqual(['view-1']);
            expect(harness.editorOf('view-1').viewId).toBeNull();

            harness.transport.status = 'open';
            await harness.client.resume();
            await tick(20);
            expect(harness.transport.of('save')).toHaveLength(0);
        });

        test('going to another file and back before the save on the way out is answered keeps the editor that is drawn', async () => {
            await open();
            kind.add(harness.current(), 'b');
            documents().getState().setActiveView('view-2');
            documents().getState().setActiveView('view-1');
            await tick(20);

            expect(harness.transport.viewIdsOf('open')).toEqual(['view-1', 'view-2']);
            expect(harness.transport.viewIdsOf('close')).toEqual(['view-2']);
            expect(harness.editorOf('view-1').viewId).toBe('view-1');
            expect(kind.ids(harness.editorOf('view-1'))).toEqual(['a', 'b']);

            // The editor on screen is the one this client saves, so the next edit reaches the file.
            kind.add(harness.editorOf('view-1'), 'c');
            await tick(20);
            const saves = harness.transport.of('save');
            expect(saves.map((call) => (call.payload as { viewId: string }).viewId)).toEqual(['view-1', 'view-1']);
            expect(kind.written((saves.at(-1)!.payload as { content: unknown }).content)).toEqual(['a', 'b', 'c']);
        });

        test('a file that comes up while the save of another is held is followed at once, and its edits are kept and saved', async () => {
            await open();
            kind.add(harness.current(), 'b');
            const releaseA = harness.transport.hold('save', 'view-1');
            documents().getState().setActiveView('view-2');
            await tick(5);
            documents().getState().setActiveView('view-3');
            await tick(5);

            // The save of A is still out, and C is open and loaded all the same.
            expect(harness.transport.viewIdsOf('save')).toEqual(['view-1']);
            expect(harness.transport.viewIdsOf('open')).toEqual(['view-1', 'view-2', 'view-3']);
            expect(harness.editorOf('view-3').viewId).toBe('view-3');
            kind.add(harness.editorOf('view-3'), 'c');
            await tick(20);
            const savedC = harness.transport.of('save').filter((call) => (call.payload as { viewId: string }).viewId === 'view-3');
            expect(savedC).toHaveLength(1);
            expect(kind.written((savedC[0]!.payload as { content: unknown }).content)).toEqual(['a', 'c']);

            releaseA();
            await tick(20);
            expect(harness.transport.viewIdsOf('close').toSorted()).toEqual(['view-1', 'view-2']);
            expect(harness.transport.viewIdsOf('open')).toEqual(['view-1', 'view-2', 'view-3']);
            const savedA = harness.transport.of('save').find((call) => (call.payload as { viewId: string }).viewId === 'view-1');
            expect(kind.written((savedA!.payload as { content: unknown }).content)).toEqual(['a', 'b']);
            expect(kind.ids(harness.editorOf('view-3'))).toEqual(['a', 'c']);
            expect(harness.editorOf('view-3').dirty).toBe(false);
            expect(harness.editorOf('view-3').rev).toBe(6);
        });

        test('a view taken back while its save on the way out is held stays open and is not loaded again', async () => {
            await open();
            kind.add(harness.current(), 'b');
            const release = harness.transport.hold('save', 'view-1');
            documents().getState().setActiveView('main');
            await tick(5);
            documents().getState().setActiveView('view-1');
            await tick(5);
            kind.add(harness.editorOf('view-1'), 'c');
            release();
            await tick(20);

            expect(harness.transport.of('open')).toHaveLength(1);
            expect(harness.transport.of('close')).toHaveLength(0);
            expect(kind.ids(harness.editorOf('view-1'))).toEqual(['a', 'b', 'c']);
            const written = harness.transport.of('save').at(-1)?.payload as { content: unknown; baseRev: number };
            expect(kind.written(written.content)).toEqual(['a', 'b', 'c']);
            expect(written.baseRev).toBe(6);
            expect(harness.editorOf('view-1').dirty).toBe(false);
        });

        test('work drawn before the file arrived is kept on screen, with the file in the banner', async () => {
            const release = harness.transport.hold('open', 'view-1');
            documents().getState().setActiveView('view-1');
            await tick();
            kind.add(harness.editorOf('view-1'), 'x');
            await tick(20);
            // Nothing to save against yet.
            expect(harness.transport.of('save')).toHaveLength(0);

            release();
            await tick();
            expect(kind.ids(harness.editorOf('view-1'))).toEqual(['x']);
            expect(harness.editorOf('view-1').conflict).toMatchObject({ rev: 5 });
            await tick(20);
            expect(harness.transport.of('save')).toHaveLength(0);

            await harness.client.resolveConflict('mine');
            await tick(20);
            const saves = harness.transport.of('save');
            expect(saves).toHaveLength(1);
            expect(saves[0]!.payload).toMatchObject({ viewId: 'view-1', baseRev: 5 });
            expect(kind.written((saves[0]!.payload as { content: unknown }).content)).toEqual(['x']);
        });

        test('taking the file over work drawn before it arrived loads the file', async () => {
            const release = harness.transport.hold('open', 'view-1');
            documents().getState().setActiveView('view-1');
            await tick();
            kind.add(harness.editorOf('view-1'), 'x');
            release();
            await tick();
            await harness.client.resolveConflict('theirs');
            await tick(20);
            expect(kind.ids(harness.editorOf('view-1'))).toEqual(['a']);
            expect(harness.transport.of('save')).toHaveLength(0);
        });

        test('a document that arrives after the client let go lands nowhere', async () => {
            const release = harness.transport.hold('open', 'view-1');
            documents().getState().setActiveView('view-1');
            await tick();
            harness.client.dispose();
            release();
            await tick(20);
            expect(harness.editorOf('view-1').viewId).toBeNull();
        });

        test('a document for a view that went away before it arrived is not loaded', async () => {
            const release = harness.transport.hold('open', 'view-1');
            documents().getState().setActiveView('view-1');
            await tick();
            documents().getState().setActiveView('main');
            await tick();
            release();
            await tick(20);
            expect(harness.transport.viewIdsOf('close')).toEqual(['view-1']);
            expect(harness.editorOf('view-1').viewId).toBeNull();
        });

        test('nothing closes between projects, and what left closes once the switch is over', async () => {
            await open();
            kind.add(harness.current(), 'b');
            harness.stores.project.getState().setSwitching(true);
            documents().getState().setActiveView('main');
            await tick(20);
            expect(harness.transport.of('close')).toHaveLength(0);
            expect(harness.editorOf('view-1').viewId).toBe('view-1');

            harness.stores.project.getState().setSwitching(false);
            await tick(20);
            expect(harness.transport.viewIdsOf('save')).toEqual(['view-1']);
            expect(harness.transport.viewIdsOf('close')).toEqual(['view-1']);
        });

        test('the project being read again after a reconnect opens the file on the daemon', async () => {
            await open();
            harness.transport.reconnect();
            documents().getState().load(project(kind.name), { activeViewId: 'view-1', views: {} });
            await tick(20);
            expect(harness.transport.of('open')).toHaveLength(2);
        });

        test('copying a view flushes both files first and asks the daemon for the copy', async () => {
            await open();
            const opened = harness.transport.next('open', 'view-2');
            documents().getState().splitFocused('right', 'view-2');
            await opened;
            await harness.loaded('view-2');
            kind.add(harness.editorOf('view-1'), 'source');
            kind.add(harness.editorOf('view-2'), 'destination');
            const releaseSource = harness.transport.hold('save', 'view-1');
            const releaseDestination = harness.transport.hold('save', 'view-2');
            const sourceSaving = harness.transport.next('save', 'view-1');
            const destinationSaving = harness.transport.next('save', 'view-2');
            const gate = harness.holdProject();
            const copying = harness.client.copy('view-1', 'view-2');
            await Promise.all([sourceSaving, destinationSaving]);
            expect(harness.transport.of('copy')).toEqual([]);
            const flushing = harness.client.flush();
            expect(harness.transport.viewIdsOf('save')).toEqual(['view-1', 'view-2']);
            const sourceSaved = new Promise<void>((resolve) => {
                const off = kind
                    .registry(harness.stores)
                    .of('view-1')
                    .subscribe((state) => {
                        if (state.rev === 6) {
                            off();
                            resolve();
                        }
                    });
            });
            releaseSource();
            await sourceSaved;
            expect(harness.transport.of('copy')).toEqual([]);
            expect(harness.flushes).toBe(2);
            releaseDestination();
            await gate.entered;
            expect(harness.transport.of('copy')).toEqual([]);
            gate.release();
            await Promise.all([copying, flushing]);
            expect(harness.transport.of('copy')[0]?.payload).toEqual({ projectId: 'p1', from: 'view-1', to: 'view-2' });
            expect(harness.flushes).toBe(3);
            expect(harness.transport.of('save').map((call) => kind.written((call.payload as { content: unknown }).content))).toEqual([
                ['a', 'source'],
                ['a', 'destination']
            ]);
        });
    });
}

suite(DRAWING);
suite(DIAGRAM);

describe('a diagram node dragged against an agent', () => {
    const harness = harnessFor(DIAGRAM);

    test('goes to the banner, and keeping mine writes the drag over their rev', async () => {
        harness.stores.document.getState().setActiveView('view-1');
        await tick();
        harness.current().moveNode('a', [300, 120], true);
        // The agent's write lands before the pause after the drag is over.
        harness.transport.changed('view-1', diagramDocument(8, node('a'), node('agent')));
        expect(harness.current().conflict).toMatchObject({ rev: 8 });
        await tick(20);
        // Nothing is written while the banner stands.
        expect(harness.transport.of('save')).toHaveLength(0);

        await harness.client.resolveConflict('mine');
        await tick(20);
        const saves = harness.transport.of('save');
        expect(saves).toHaveLength(1);
        const written = saves[0]!.payload as { baseRev: number; content: { nodes: DiagramNode[] } };
        expect(written.baseRev).toBe(8);
        expect(written.content.nodes).toEqual([{ id: 'a', label: 'a', pos: [300, 120] }]);
        expect(harness.current().rev).toBe(9);
        expect(harness.current().conflict).toBeNull();
    });

    test('taking theirs drops the drag and the step back to it', async () => {
        harness.stores.document.getState().setActiveView('view-1');
        await tick();
        harness.current().moveNode('a', [300, 120], true);
        harness.transport.changed('view-1', diagramDocument(8, node('a')));
        await harness.client.resolveConflict('theirs');
        expect(harness.current().content.nodes).toEqual([{ id: 'a', label: 'a' }]);
        expect(harness.current().past).toHaveLength(0);
        await tick(20);
        expect(harness.transport.of('save')).toHaveLength(0);
    });
});

describe('a drawing edited while an agent writes', () => {
    const harness = harnessFor(DRAWING);
    const sun = (): DrawingElement => ({ ...rect('sun'), x: 600 });
    const open = async (): Promise<void> => {
        harness.stores.document.getState().setActiveView('view-1');
        await tick();
    };

    test('unsaved work on other elements goes on top of their change and saves against its rev', async () => {
        await open();
        harness.current().addElement(rect('b'));
        // The agent's write lands before the pause after the edit is over.
        harness.transport.changed('view-1', { version: 1, rev: 8, elements: [rect('a'), sun()] });
        expect(harness.current().conflict).toBeNull();
        expect(DRAWING.ids(harness.current())).toEqual(['a', 'b', 'sun']);
        await tick(20);
        const saves = harness.transport.of('save');
        expect(saves).toHaveLength(1);
        expect(saves[0]!.payload).toMatchObject({ baseRev: 8 });
        expect(DRAWING.written((saves[0]!.payload as { content: unknown }).content)).toEqual(['a', 'b', 'sun']);
        expect(harness.current().rev).toBe(9);
        expect(harness.current().dirty).toBe(false);

        // Their change is one step back, and the person's own steps before it stay.
        harness.current().undo();
        expect(DRAWING.ids(harness.current())).toEqual(['a', 'b']);
        harness.current().undo();
        expect(DRAWING.ids(harness.current())).toEqual(['a']);
    });

    test('only an element both sides changed goes to the banner, and nothing is written', async () => {
        await open();
        harness.current().updateElement('a', { x: 50 });
        harness.transport.changed('view-1', { version: 1, rev: 8, elements: [{ ...rect('a'), x: 90 }, sun()] });
        expect(harness.current().conflict).toMatchObject({ rev: 8 });
        expect(harness.current().elements[0]).toMatchObject({ id: 'a', x: 50 });
        await tick(20);
        expect(harness.transport.of('save')).toHaveLength(0);
    });

    test('a change that comes while a save is out waits for its answer and is rebased on what that save wrote', async () => {
        await open();
        const release = harness.transport.hold('save', 'view-1');
        harness.current().addElement(rect('b'));
        await tick(20);
        expect(harness.transport.of('save')).toHaveLength(1);
        harness.current().addElement(rect('c'));
        // Written after the person's save landed at 6, so it holds `b` but not `c`.
        harness.transport.changed('view-1', { version: 1, rev: 7, elements: [rect('a'), rect('b'), sun()] });
        expect(harness.current().conflict).toBeNull();
        release();
        await tick(20);
        expect(harness.current().conflict).toBeNull();
        expect(DRAWING.ids(harness.current())).toEqual(['a', 'b', 'c', 'sun']);
        const saves = harness.transport.of('save');
        expect(saves.map((call) => (call.payload as { baseRev: number }).baseRev)).toEqual([5, 7]);
        expect(harness.current().rev).toBe(8);
    });

    test('a save refused for their change reads the file again and rebases onto it', async () => {
        await open();
        const release = harness.transport.hold('save', 'view-1');
        harness.current().addElement(rect('b'));
        await tick(20);
        // Their write landed first, so the daemon refuses this one save and has their file on the next open.
        harness.transport.conflictOnSave = true;
        harness.transport.document = { version: 1, rev: 6, elements: [rect('a'), sun()] };
        void harness.transport.next('open', 'view-1').then(() => {
            harness.transport.conflictOnSave = false;
        });
        release();
        await tick(20);
        expect(harness.current().conflict).toBeNull();
        expect(DRAWING.ids(harness.current())).toEqual(['a', 'b', 'sun']);
        expect(harness.transport.of('save').at(-1)!.payload).toMatchObject({ baseRev: 6 });
        expect(harness.current().rev).toBe(7);
    });
});
