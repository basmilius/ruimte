import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventMap, EventType, RequestMap, RequestType, ServerFrame } from '@ruimte/contracts';
import { FakeWatch } from '@adecore/agents/watch-test-helpers';
import { DrawingClient } from '../drawing/drawing-client';
import { DiagramClient } from '../diagram/diagram-client';
import { TransportError, type Transport } from '../transport/transport';
import { createWorkspaceStores } from './workspace';

// Runtime fixtures keep the daemon's dependency graph out of the browser typecheck.
const serverSource = '../../../server/src/';
const { Dispatcher } = await import(`${serverSource}dispatcher.ts`);
const { registerDrawingHandlers } = await import(`${serverSource}handlers/drawing.ts`);
const { registerDiagramHandlers } = await import(`${serverSource}handlers/diagram.ts`);
const { ProjectStore } = await import(`${serverSource}projects/project-store.ts`);
const { DrawingStore } = await import(`${serverSource}projects/drawing-store.ts`);
const { DiagramStore } = await import(`${serverSource}projects/diagram-store.ts`);

interface DispatcherPort {
    handle(client: { id: string; send(frame: ServerFrame): void }, message: string): Promise<void>;
}

class StoreTransport implements Transport {
    readonly status = 'open';
    readonly events: ServerFrame[] = [];
    private readonly dispatcher: DispatcherPort;
    private readonly clientId: string;
    private readonly listeners = new Map<string, Set<(payload: never) => void>>();

    constructor(dispatcher: DispatcherPort, clientId: string) {
        this.dispatcher = dispatcher;
        this.clientId = clientId;
    }

    receive(frame: ServerFrame): void {
        this.events.push(frame);
        if ('type' in frame && frame.type === 'event') {
            for (const listener of this.listeners.get(frame.event) ?? []) {
                listener(frame.payload as never);
            }
        }
    }

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        return new Promise((resolve, reject) => {
            void this.dispatcher.handle(
                {
                    id: this.clientId,
                    send: (frame) => {
                        if ('ok' in frame) {
                            if (frame.ok) {
                                resolve(frame.result as RequestMap[T]['result']);
                            } else {
                                reject(new TransportError(frame.error.code, frame.error.message));
                            }
                        }
                    }
                },
                JSON.stringify({ id: 'request', type, payload })
            );
        });
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        const listeners = this.listeners.get(event) ?? new Set();
        listeners.add(handler as (payload: never) => void);
        this.listeners.set(event, listeners);
        return () => {
            listeners.delete(handler as (payload: never) => void);
        };
    }

    subscribeStatus(): () => void {
        return () => undefined;
    }
}

beforeEach(() => {
    jest.useFakeTimers();
});
afterEach(() => {
    jest.useRealTimers();
});

for (const kind of ['drawing', 'diagram'] as const) {
    describe(`${kind} synchronization through the save handler`, () => {
        for (const otherHasEdits of [false, true]) {
            test(`a save updates the other editor ${otherHasEdits ? 'through its conflict flow' : 'in place'}`, async () => {
                const root = await mkdtemp(join(tmpdir(), 'ruimte-file-sync-'));
                const folder = join(root, 'repo');
                await mkdir(folder);
                const watch = new FakeWatch();
                const projects = new ProjectStore(join(root, 'home'), watch);
                const drawings = new DrawingStore(projects, watch);
                const diagrams = new DiagramStore(projects, watch);
                projects.attachDrawings(drawings);
                projects.attachDiagrams(diagrams);
                const opened = await projects.openProject({ folder });
                const projectId = opened.summary.projectId;
                await projects.save(projectId, 0, { name: 'repo', color: '#353e53', views: [{ kind, id: 'view', name: 'View' }] });
                const dispatcher = new Dispatcher();
                registerDrawingHandlers(dispatcher, drawings);
                registerDiagramHandlers(dispatcher, diagrams);
                const store = kind === 'drawing' ? drawings : diagrams;
                const first = new StoreTransport(dispatcher, 'first');
                const second = new StoreTransport(dispatcher, 'second');
                const off = [
                    store.subscribe('first', (event: { event: string; payload: unknown }) => first.receive({ type: 'event', ...event })),
                    store.subscribe('second', (event: { event: string; payload: unknown }) => second.receive({ type: 'event', ...event }))
                ];
                const document = (await projects.openProject({ projectId })).document;
                const screens = [first, second].map((transport) => {
                    const stores = createWorkspaceStores();
                    stores.document.getState().load(document, { activeViewId: 'view', views: {} });
                    stores.project.getState().setCurrent(opened.summary, document.rev, 'machine');
                    const loaded = new Promise<void>((resolve) => {
                        const registry = kind === 'drawing' ? stores.drawings : stores.diagrams;
                        const off = registry.subscribe((_viewId, state) => {
                            if (state.viewId === 'view' && !state.loading) {
                                off();
                                resolve();
                            }
                        });
                    });
                    const client =
                        kind === 'drawing'
                            ? new DrawingClient(transport, stores.drawings, stores.document, stores.project, { window: null, document: null })
                            : new DiagramClient(transport, stores.diagrams, stores.document, stores.project, { window: null, document: null });
                    const add = (id: string) => {
                        if (kind === 'drawing') {
                            stores.drawings
                                .of('view')
                                .getState()
                                .addElement({ kind: 'rect', id, x: 0, y: 0, w: 100, h: 60, stroke: 'ink', strokeWidth: 2, seed: 1 });
                        } else {
                            const state = stores.diagrams.of('view').getState();
                            state.replaceContent({ ...state.content, nodes: [{ id, label: id }] });
                        }
                    };
                    const state = () => (kind === 'drawing' ? stores.drawings.of('view').getState() : stores.diagrams.of('view').getState());
                    const ids = () =>
                        kind === 'drawing'
                            ? stores.drawings
                                  .of('view')
                                  .getState()
                                  .elements.map((element) => element.id)
                            : stores.diagrams
                                  .of('view')
                                  .getState()
                                  .content.nodes.map((node) => node.id);
                    return { client, add, state, ids, loaded };
                });
                try {
                    await Promise.all(screens.map((screen) => screen.loaded));
                    expect(screens.map((screen) => screen.state().loading)).toEqual([false, false]);
                    if (otherHasEdits) {
                        screens[1]!.add('mine');
                    }
                    screens[0]!.add('new');
                    await screens[0]!.client.flush();
                    expect(screens[0]!.state().conflict).toBeNull();
                    expect(first.events).toEqual([]);
                    expect(second.events).toHaveLength(1);
                    if (otherHasEdits) {
                        expect(screens[1]!.ids()).toEqual(['mine']);
                        expect(screens[1]!.state().dirty).toBe(true);
                        expect(screens[1]!.state().conflict).toMatchObject({ rev: 1 });
                        await screens[1]!.client.resolveConflict('theirs');
                    }
                    expect(screens[1]!.ids()).toEqual(['new']);
                    expect(screens[1]!.state().rev).toBe(1);
                } finally {
                    screens.forEach((screen) => screen.client.dispose());
                    off.forEach((unsubscribe) => unsubscribe());
                    projects.closeAll();
                    await rm(root, { recursive: true, force: true });
                }
            });
        }
    });
}
