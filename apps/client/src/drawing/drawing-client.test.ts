import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { DrawingDocument, DrawingElement, EventMap, EventType, ProjectDocument, ProjectSummary, RequestMap, RequestType } from '@ruimte/contracts';
import { useDocument } from '@/state/document';
import { createDrawingStore, type DrawingState } from '@/state/drawing';
import { createEditorRegistry } from '@/state/editors';
import { useProject } from '@/state/project';
import { TransportError, type Transport, type TransportStatus } from '@/transport/transport';
import { DrawingClient } from './drawing-client';

type Call = { type: RequestType; payload: unknown };

/* The client owns its editors, so the test hands it a registry of its own and reads what it opened. */
const drawings = createEditorRegistry(createDrawingStore);

/* The drawing the client has open, or the blank one when it closed the last one. */
const drawing = (): DrawingState => (drawings.live()[0]?.[1] ?? drawings.blank).getState();

/* One named editor, for the tests where more than one drawing is on screen at a time. */
const editorOf = (viewId: string) => drawings.peek(viewId) ?? drawings.blank;

const rect = (id: string, x = 0): DrawingElement => ({ kind: 'rect', id, x, y: 0, w: 100, h: 60, stroke: 'ink', strokeWidth: 2, seed: 1 });

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
    version: 3,
    rev: 1,
    name: 'p',
    color: '#000',
    views: [
        { kind: 'canvas', id: 'main', name: 'Canvas', nodes: [], texts: [], edges: [], layouts: [] },
        { kind: 'drawing', id: 'view-1', name: 'Sketch' },
        { kind: 'drawing', id: 'view-2', name: 'Plan' }
    ]
});

class FakeTransport implements Transport {
    status: TransportStatus = 'open';
    readonly calls: Call[] = [];
    document: DrawingDocument = { version: 1, rev: 5, elements: [rect('a')] };
    /* Set to refuse the next save the way the daemon refuses a stale rev. */
    conflictOnSave = false;
    /* A restarted daemon: it knows no rev for the drawing until it is opened again. */
    forgotten = false;
    private readonly eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        this.calls.push({ type, payload });
        if (type === 'drawing.open') {
            this.forgotten = false;
            return Promise.resolve({ document: this.document } as RequestMap[T]['result']);
        }
        if (type === 'drawing.save') {
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

// Fake timers leave setImmediate alone: each step runs the timers due in that millisecond, then every promise they started.
const tick = async (ms = 5): Promise<void> => {
    for (let i = 0; i < ms; i++) {
        jest.advanceTimersByTime(1);
        await new Promise((resolve) => setImmediate(resolve));
    }
};

let transport: FakeTransport;
let client: DrawingClient;
let flushes: number;

const setup = (): void => {
    drawings.keep([]);
    useProject.getState().setCurrent(summary, 1, 'daemon-a');
    useDocument.getState().load(project(), {
        activeViewId: 'main',
        views: { 'view-1': { camera: { center: { x: 3, y: 4 }, zoom: 2 }, focusedNodeId: null } }
    });
    transport = new FakeTransport();
    flushes = 0;
    client = new DrawingClient(transport, drawings, useDocument, useProject, {
        saveDelayMs: 1,
        window: null,
        document: null,
        flushProject: () => {
            flushes += 1;
            return Promise.resolve();
        }
    });
};

beforeEach(() => {
    jest.useFakeTimers();
    setup();
});

// A client that outlives its test would keep saving into the next one.
afterEach(() => {
    client.dispose();
    jest.useRealTimers();
});

describe('DrawingClient', () => {
    test('a drawing coming up is opened, loaded and given the camera this machine remembers', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        expect(transport.of('drawing.open')[0]?.payload).toEqual({ projectId: 'p1', viewId: 'view-1' });
        // The project file is written first, or the daemon would not know the view yet.
        expect(flushes).toBe(1);
        expect(drawing().elements.map((element) => element.id)).toEqual(['a']);
        expect(drawing().rev).toBe(5);
        // Nothing has measured the drawing yet, so the camera waits and is handed back as it came.
        expect(drawing().viewCamera()).toEqual({ center: { x: 3, y: 4 }, zoom: 2 });
    });

    test('a page that gets the views before the project still opens the drawing', async () => {
        // What a reload does: the client is up, the document store fills, the project lands last.
        client.dispose();
        drawings.keep([]);
        useProject.getState().setCurrent(null, 0, null);
        useDocument.getState().load(null, null);
        transport = new FakeTransport();
        client = new DrawingClient(transport, drawings, useDocument, useProject, { saveDelayMs: 1, window: null, document: null });

        useProject.getState().setSwitching(true);
        useDocument.getState().load(project(), { activeViewId: 'view-1', views: {} });
        useProject.getState().setCurrent(summary, 1, 'daemon-a');
        useProject.getState().setSwitching(false);
        await tick();

        expect(transport.of('drawing.open')).toHaveLength(1);
        expect(drawing().elements.map((element) => element.id)).toEqual(['a']);
    });

    test('an edit saves after the pause, against the rev it was loaded on', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        drawing().addElement(rect('b', 200));
        expect(drawing().dirty).toBe(true);
        await tick(20);
        expect(transport.of('drawing.save')).toHaveLength(1);
        expect(transport.of('drawing.save')[0]?.payload).toMatchObject({ projectId: 'p1', viewId: 'view-1', baseRev: 5 });
        expect(drawing().rev).toBe(6);
        expect(drawing().dirty).toBe(false);
    });

    test('edits made during a save ride the next one, never a second write at the same time', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        drawing().addElement(rect('b'));
        await tick(20);
        drawing().addElement(rect('c'));
        await tick(20);
        expect(transport.of('drawing.save').map((call) => (call.payload as { baseRev: number }).baseRev)).toEqual([5, 6]);
    });

    test('a save the daemon refuses waits for the file, and the banner gets it', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        transport.conflictOnSave = true;
        drawing().addElement(rect('b'));
        await tick(20);
        expect(drawing().dirty).toBe(true);
        expect(drawing().error).toBeNull();

        transport.emit('drawing.changed', { projectId: 'p1', viewId: 'view-1', document: { version: 1, rev: 9, elements: [rect('z')] } });
        expect(drawing().conflict).toMatchObject({ rev: 9 });
        // Taking the file loads it and stops the drawing from being dirty.
        await client.resolveConflict('theirs');
        expect(drawing().elements.map((element) => element.id)).toEqual(['z']);
        expect(drawing().rev).toBe(9);
    });

    test('taking theirs drops the save the stroke that caused the conflict still had waiting', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        drawing().addElement(rect('b'));
        // Their write lands before the pause after the stroke is over.
        transport.emit('drawing.changed', { projectId: 'p1', viewId: 'view-1', document: { version: 1, rev: 8, elements: [rect('z')] } });
        expect(drawing().conflict).toMatchObject({ rev: 8 });

        await client.resolveConflict('theirs');
        expect(drawing().elements.map((element) => element.id)).toEqual(['z']);
        await tick(20);

        expect(transport.of('drawing.save')).toHaveLength(0);
        expect(drawing().rev).toBe(8);
    });

    test('a change from disk with nothing unsaved is loaded in place', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        transport.emit('drawing.changed', { projectId: 'p1', viewId: 'view-1', document: { version: 1, rev: 7, elements: [rect('z')] } });
        expect(drawing().conflict).toBeNull();
        expect(drawing().elements.map((element) => element.id)).toEqual(['z']);
        expect(drawing().rev).toBe(7);
    });

    test('a change for another drawing is not this one', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        transport.emit('drawing.changed', { projectId: 'p1', viewId: 'view-2', document: { version: 1, rev: 7, elements: [rect('z')] } });
        expect(drawing().elements.map((element) => element.id)).toEqual(['a']);
    });

    test('switching views writes what is pending and closes the drawing behind it', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        drawing().addElement(rect('b'));
        useDocument.getState().setActiveView('main');
        await tick(20);
        expect(transport.of('drawing.save')).toHaveLength(1);
        expect(transport.of('drawing.close')[0]?.payload).toEqual({ projectId: 'p1', viewId: 'view-1' });
        expect(drawing().viewId).toBeNull();
    });

    test('two drawings side by side are both open, and each saves into its own file', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        useDocument.getState().splitFocused('right', 'view-2');
        await tick(20);
        expect(transport.of('drawing.open').map((call) => (call.payload as { viewId: string }).viewId)).toEqual(['view-1', 'view-2']);
        expect(transport.of('drawing.close')).toHaveLength(0);

        // Each cell edits its own editor, so an edit in one may never be written into the other's file.
        editorOf('view-1').getState().addElement(rect('b'));
        await tick(20);
        expect(transport.of('drawing.save').map((call) => (call.payload as { viewId: string }).viewId)).toEqual(['view-1']);
    });

    test('closing one cell closes that drawing and leaves the other open', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        useDocument.getState().splitFocused('right', 'view-2');
        await tick(20);
        useDocument.getState().closeCellAt({ column: 1, cell: 0 });
        await tick(20);
        expect(transport.of('drawing.close').map((call) => (call.payload as { viewId: string }).viewId)).toEqual(['view-2']);
        expect(editorOf('view-1').getState().viewId).toBe('view-1');
    });

    test('a drawing whose view is deleted is dropped without a save, so no orphan file comes back', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        drawing().addElement(rect('b'));
        useDocument.getState().deleteView('view-1');
        await tick(20);
        expect(transport.of('drawing.save')).toHaveLength(0);
        // The neighbor takes over, which is another drawing, so the store holds that one now.
        expect(drawing().viewId).toBe('view-2');
    });

    test('a daemon that forgot the drawing gets it again, and the work that was waiting lands', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        drawing().addElement(rect('b', 200));
        await tick(20);
        expect(drawing().rev).toBe(6);

        transport.document = { version: 1, rev: 6, elements: [rect('a'), rect('b', 200)] };
        transport.forgotten = true;
        transport.reconnect();
        drawing().addElement(rect('c', 400));
        await tick(30);

        expect(transport.of('drawing.open')).toHaveLength(2);
        expect(drawing().dirty).toBe(false);
        expect(drawing().rev).toBe(7);
        const written = transport.of('drawing.save').at(-1)?.payload as { content: { elements: DrawingElement[] } };
        expect(written.content.elements.map((element) => element.id)).toEqual(['a', 'b', 'c']);
    });

    test('an edit made while the link is down waits, and a resume opens the drawing again and writes it', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        transport.status = 'closed';
        transport.reconnect();
        drawing().addElement(rect('b', 200));
        await tick(20);
        expect(transport.of('drawing.save')).toHaveLength(0);
        expect(drawing().dirty).toBe(true);

        transport.status = 'open';
        await client.resume();
        await tick(20);
        expect(transport.of('drawing.open')).toHaveLength(2);
        expect(transport.of('drawing.save')).toHaveLength(1);
        expect(drawing().dirty).toBe(false);
    });

    test('the project being read again after a reconnect opens the drawing on the daemon', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        transport.reconnect();
        useDocument.getState().load(project(), { activeViewId: 'view-1', views: {} });
        await tick(20);
        expect(transport.of('drawing.open')).toHaveLength(2);
    });

    test('copying a view flushes both files first and asks the daemon for the copy', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        await client.copy('view-1', 'view-2');
        expect(transport.of('drawing.copy')[0]?.payload).toEqual({ projectId: 'p1', from: 'view-1', to: 'view-2' });
        expect(flushes).toBe(2);
    });
});
