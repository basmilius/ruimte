import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DrawingDocument, DrawingElement, EventMap, EventType, ProjectDocument, ProjectSummary, RequestMap, RequestType } from '@ruimte/contracts';
import { useDocument } from '@/state/document';
import { useDrawing } from '@/state/drawing';
import { useProject } from '@/state/project';
import { TransportError, type Transport, type TransportStatus } from '@/transport/transport';
import { DrawingClient } from './drawing-client';

type Call = { type: RequestType; payload: unknown };

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
    version: 2,
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
    private readonly eventHandlers = new Map<string, Set<(payload: unknown) => void>>();

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        this.calls.push({ type, payload });
        if (type === 'drawing.open') {
            return Promise.resolve({ document: this.document } as RequestMap[T]['result']);
        }
        if (type === 'drawing.save') {
            if (this.conflictOnSave) {
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

    subscribeStatus(): () => void {
        return () => undefined;
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
let client: DrawingClient;
let flushes: number;

const setup = (): void => {
    useDrawing.getState().unload();
    useProject.getState().setCurrent(summary, 1);
    useDocument.getState().load(project(), {
        activeViewId: 'main',
        views: { 'view-1': { camera: { x: 3, y: 4, zoom: 2 }, focusedNodeId: null } }
    });
    transport = new FakeTransport();
    flushes = 0;
    client = new DrawingClient(transport, useDrawing, useDocument, useProject, {
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

describe('DrawingClient', () => {
    test('a drawing coming up is opened, loaded and given the camera this machine remembers', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        expect(transport.of('drawing.open')[0]?.payload).toEqual({ projectId: 'p1', viewId: 'view-1' });
        // The project file is written first, or the daemon would not know the view yet.
        expect(flushes).toBe(1);
        expect(useDrawing.getState().elements.map((element) => element.id)).toEqual(['a']);
        expect(useDrawing.getState().rev).toBe(5);
        expect(useDrawing.getState().camera).toEqual({ x: 3, y: 4, zoom: 2 });
    });

    test('an edit saves after the pause, against the rev it was loaded on', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        useDrawing.getState().addElement(rect('b', 200));
        expect(useDrawing.getState().dirty).toBe(true);
        await tick(20);
        expect(transport.of('drawing.save')).toHaveLength(1);
        expect(transport.of('drawing.save')[0]?.payload).toMatchObject({ projectId: 'p1', viewId: 'view-1', baseRev: 5 });
        expect(useDrawing.getState().rev).toBe(6);
        expect(useDrawing.getState().dirty).toBe(false);
    });

    test('edits made during a save ride the next one, never a second write at the same time', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        useDrawing.getState().addElement(rect('b'));
        await tick(20);
        useDrawing.getState().addElement(rect('c'));
        await tick(20);
        expect(transport.of('drawing.save').map((call) => (call.payload as { baseRev: number }).baseRev)).toEqual([5, 6]);
    });

    test('a save the daemon refuses waits for the file, and the banner gets it', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        transport.conflictOnSave = true;
        useDrawing.getState().addElement(rect('b'));
        await tick(20);
        expect(useDrawing.getState().dirty).toBe(true);
        expect(useDrawing.getState().error).toBeNull();

        transport.emit('drawing.changed', { projectId: 'p1', viewId: 'view-1', document: { version: 1, rev: 9, elements: [rect('z')] } });
        expect(useDrawing.getState().conflict).toMatchObject({ rev: 9 });
        // Taking the file loads it and stops the drawing from being dirty.
        await client.resolveConflict('theirs');
        expect(useDrawing.getState().elements.map((element) => element.id)).toEqual(['z']);
        expect(useDrawing.getState().rev).toBe(9);
    });

    test('a change from disk with nothing unsaved is loaded in place', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        transport.emit('drawing.changed', { projectId: 'p1', viewId: 'view-1', document: { version: 1, rev: 7, elements: [rect('z')] } });
        expect(useDrawing.getState().conflict).toBeNull();
        expect(useDrawing.getState().elements.map((element) => element.id)).toEqual(['z']);
        expect(useDrawing.getState().rev).toBe(7);
    });

    test('a change for another drawing is not this one', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        transport.emit('drawing.changed', { projectId: 'p1', viewId: 'view-2', document: { version: 1, rev: 7, elements: [rect('z')] } });
        expect(useDrawing.getState().elements.map((element) => element.id)).toEqual(['a']);
    });

    test('switching views writes what is pending and closes the drawing behind it', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        useDrawing.getState().addElement(rect('b'));
        useDocument.getState().setActiveView('main');
        await tick(20);
        expect(transport.of('drawing.save')).toHaveLength(1);
        expect(transport.of('drawing.close')[0]?.payload).toEqual({ projectId: 'p1', viewId: 'view-1' });
        expect(useDrawing.getState().viewId).toBeNull();
    });

    test('a drawing whose view is deleted is dropped without a save, so no orphan file comes back', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        useDrawing.getState().addElement(rect('b'));
        useDocument.getState().deleteView('view-1');
        await tick(20);
        expect(transport.of('drawing.save')).toHaveLength(0);
        // The neighbor takes over, which is another drawing, so the store holds that one now.
        expect(useDrawing.getState().viewId).toBe('view-2');
    });

    test('copying a view flushes both files first and asks the daemon for the copy', async () => {
        useDocument.getState().setActiveView('view-1');
        await tick();
        await client.copy('view-1', 'view-2');
        expect(transport.of('drawing.copy')[0]?.payload).toEqual({ projectId: 'p1', from: 'view-1', to: 'view-2' });
        expect(flushes).toBe(2);
    });
});
