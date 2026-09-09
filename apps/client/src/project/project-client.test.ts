import { describe, expect, test } from 'bun:test';
import type { EventMap, EventType, ProjectDocument, ProjectSummary, RequestMap, RequestType } from '@ruimte/contracts';
import { useCanvas } from '../state/canvas';
import { TransportError, type Transport, type TransportStatus } from '../transport/transport';
import { ProjectClient, type ProjectSink } from './project-client';

type Call = { type: RequestType; payload: unknown };

const summary = (projectId: string, folder: string | null = null): ProjectSummary => ({
    projectId,
    name: projectId,
    color: '#000',
    folder,
    lastOpenedAt: 0,
    available: true
});

const document = (rev: number, nodes: ProjectDocument['nodes'] = []): ProjectDocument => ({
    version: 1,
    rev,
    name: 'p',
    color: '#000',
    nodes,
    texts: [],
    edges: []
});

class FakeTransport implements Transport {
    status: TransportStatus = 'open';
    readonly calls: Call[] = [];
    projects: ProjectSummary[] = [summary('p1', '/repo')];
    rev = 3;
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
                return Promise.resolve({
                    summary: target,
                    document: document(this.rev),
                    local: { camera: { x: 5, y: 6, zoom: 1 }, focusedNodeId: null }
                } as RequestMap[T]['result']);
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
    const state: ReturnType<ProjectSink['getState']> & { projects: ProjectSummary[]; error: string | null } = {
        current: null,
        rev: 0,
        dirty: false,
        conflict: null,
        projects: [],
        error: null
    };
    const sink: ProjectSink = {
        setProjects: (projects) => {
            state.projects = projects;
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
        setDirty: (dirty) => {
            state.dirty = dirty;
        },
        setConflict: (conflict) => {
            state.conflict = conflict;
        },
        setError: (error) => {
            state.error = error;
        },
        getState: () => state
    };
    return { sink, state };
};

const tick = (ms = 5): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const setup = () => {
    useCanvas.getState().loadDocument(null, null);
    const transport = new FakeTransport();
    const { sink, state } = makeSink();
    const storage = new Map<string, string>();
    const client = new ProjectClient(transport, useCanvas, sink, {
        saveDelayMs: 1,
        localDelayMs: 1,
        storage: {
            getItem: (key) => storage.get(key) ?? null,
            setItem: (key, value) => void storage.set(key, value),
            removeItem: (key) => void storage.delete(key)
        }
    });
    return { transport, sink, state, client, storage };
};

describe('ProjectClient', () => {
    test('boots into the remembered or first project and loads its document and camera', async () => {
        const { transport, state, client } = setup();
        await tick();
        expect(transport.of('project.open')[0]?.payload).toEqual({ projectId: 'p1' });
        expect(state.current?.projectId).toBe('p1');
        expect(state.rev).toBe(3);
        expect(useCanvas.getState().camera).toEqual({ x: 5, y: 6, zoom: 1 });
        client.dispose();
    });

    test('an edit saves after the pause against the loaded rev, and a camera move only touches the local file', async () => {
        const { transport, state, client } = setup();
        await tick();
        useCanvas.getState().addNode('terminal', { x: 0, y: 0 });
        expect(state.dirty).toBe(true);
        await tick(10);
        const save = transport.of('project.save')[0]?.payload as { baseRev: number; content: { nodes: unknown[] } };
        expect(save.baseRev).toBe(3);
        expect(save.content.nodes).toHaveLength(1);
        expect(state.rev).toBe(4);
        expect(state.dirty).toBe(false);

        useCanvas.getState().panBy(10, 10);
        await tick(10);
        expect(transport.of('project.save')).toHaveLength(1);
        expect(transport.of('project.save-local').at(-1)?.payload).toMatchObject({ projectId: 'p1', local: { camera: { x: 15, y: 16, zoom: 1 } } });
        client.dispose();
    });

    test('a change from disk replaces a clean canvas, and waits behind a conflict when there are edits', async () => {
        const { transport, state, client } = setup();
        await tick();
        transport.emit('project.changed', { projectId: 'p1', document: document(9, [{ id: 'n', kind: 'browser', title: 'b', x: 0, y: 0, w: 10, h: 10 }]) });
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
        client.dispose();
    });

    test('keeping mine after a conflict writes over the newer rev', async () => {
        const { transport, state, client } = setup();
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
        client.dispose();
    });

    test('switching projects flushes edits, closes the old one and remembers the new one', async () => {
        const { transport, state, client, storage } = setup();
        await tick();
        transport.projects = [summary('p1', '/repo'), summary('p2')];
        useCanvas.getState().addText({ x: 0, y: 0 });
        await client.openProject('p2');
        expect(transport.of('project.save')).toHaveLength(1);
        expect(transport.of('project.close').map((call) => call.payload)).toEqual([{ projectId: 'p1' }]);
        expect(state.current?.projectId).toBe('p2');
        expect(storage.get('ruimte.lastProject')).toBe('p2');
        client.dispose();
    });

    test('closing leaves an empty canvas and no current project', async () => {
        const { state, client } = setup();
        await tick();
        useCanvas.getState().addNode('terminal', { x: 0, y: 0 });
        await client.closeProject();
        expect(state.current).toBeNull();
        expect(useCanvas.getState().order).toEqual([]);
        client.dispose();
    });
});
