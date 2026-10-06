import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectCanvasView, ProjectContent, ProjectDocument, ServerFrame } from '@ruimte/contracts';
import { connectionOpener, type ClientChannel, type ConnectionServices, type OpenConnection } from '../connection.ts';
import { Dispatcher } from '../dispatcher.ts';
import { FakeWatch } from '@adecore/agents/watch-test-helpers';
import type { InlineChatHost } from '../projects/inline-chat.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { registerProjectHandlers } from './project.ts';

class FakeChannel implements ClientChannel {
    readonly frames: ServerFrame[] = [];
    private readonly closeListeners: Array<() => void> = [];

    send(data: string): number {
        this.frames.push(JSON.parse(data) as ServerFrame);
        return data.length;
    }

    bufferedAmount(): number {
        return 0;
    }

    close(): void {}

    onClose(listener: () => void): void {
        this.closeListeners.push(listener);
    }

    /* The socket going, the way the server's `close` handler reports it. */
    drop(): void {
        for (const listener of this.closeListeners) {
            listener();
        }
    }

    onDrain(): void {}
}

const quiet = { subscribe: () => () => undefined, detachAll: () => undefined };

let root: string;
let folder: string;
let store: ProjectStore;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-project-handlers-'));
    folder = join(root, 'repo');
    await mkdir(folder);
    store = new ProjectStore(join(root, 'home'), new FakeWatch());
});

afterEach(async () => {
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

/* Two clients of one daemon. A socket and, beside it, a channel that got in the way a direct connection does. */
function twoClients(inline?: InlineChatHost) {
    const dispatcher = new Dispatcher();
    registerProjectHandlers(dispatcher, store, undefined, inline);
    const services: ConnectionServices = {
        dispatcher,
        sessions: { ...quiet, get: () => undefined },
        chats: quiet,
        identity: quiet,
        projects: store,
        drawings: quiet,
        diagrams: quiet,
        folders: quiet,
        statuses: quiet,
        usage: quiet,
        limits: quiet,
        processes: quiet
    };
    const open = connectionOpener(services);
    const socket = new FakeChannel();
    const direct = new FakeChannel();
    return {
        a: { channel: socket, connection: open(socket, { reachability: 'loopback', sessionId: null }) },
        b: { channel: direct, connection: open(direct, { reachability: 'lan', sessionId: 'paired-1' }) }
    };
}

let nextId = 1;

/* The store writes to a real temp folder, so the loop yields until the reply is in; no clock decides. */
async function request<T>(client: { channel: FakeChannel; connection: OpenConnection }, type: string, payload: unknown): Promise<T> {
    const id = `r${nextId++}`;
    client.connection.receive(JSON.stringify({ id, type, payload }));
    for (;;) {
        const reply = client.channel.frames.find((frame) => 'id' in frame && frame.id === id);
        if (reply && 'ok' in reply) {
            if (!reply.ok) {
                throw new Error(reply.error.message);
            }
            return reply.result as T;
        }
        await new Promise((resolve) => setImmediate(resolve));
    }
}

function changesIn(channel: FakeChannel): ProjectDocument[] {
    return channel.frames.flatMap((frame) =>
        'event' in frame && frame.event === 'project.changed' ? [(frame.payload as { document: ProjectDocument }).document] : []
    );
}

function contentOf({ version: _version, rev: _rev, ...content }: ProjectDocument): ProjectContent {
    return content;
}

function canvas(id: string, name: string): ProjectCanvasView {
    return { kind: 'canvas', id, name, nodes: [], texts: [], edges: [], layouts: [] };
}

/* Both clients open the same project with two views; what comes back is the rev and content they start from. */
async function openOnBoth(clients: ReturnType<typeof twoClients>) {
    const opened = await request<{ summary: { projectId: string }; document: ProjectDocument }>(clients.a, 'project.open', { folder });
    const projectId = opened.summary.projectId;
    const start = { ...contentOf(opened.document), views: [canvas('main', 'Main'), canvas('notes', 'Notes')] };
    const { rev } = await request<{ rev: number }>(clients.a, 'project.save', { projectId, baseRev: opened.document.rev, content: start });
    await request(clients.b, 'project.open', { projectId });
    clients.a.channel.frames.length = 0;
    clients.b.channel.frames.length = 0;
    return { projectId, rev, start };
}

describe('a save in one client', () => {
    test('a renamed view reaches the other client, and not the one that saved it', async () => {
        const clients = twoClients();
        const { projectId, rev, start } = await openOnBoth(clients);

        const renamed = { ...start, views: [canvas('main', 'Main'), { ...canvas('notes', 'Ideas'), titleSource: 'user' as const }] };
        await request(clients.a, 'project.save', { projectId, baseRev: rev, content: renamed });

        expect(changesIn(clients.b.channel).map((document) => [document.rev, document.views.map((view) => 'name' in view && view.name)])).toEqual([
            [rev + 1, ['Main', 'Ideas']]
        ]);
        expect(changesIn(clients.a.channel)).toEqual([]);
    });

    test('views put in another order reach the other client', async () => {
        const clients = twoClients();
        const { projectId, rev, start } = await openOnBoth(clients);

        await request(clients.a, 'project.save', { projectId, baseRev: rev, content: { ...start, views: [...start.views].reverse() } });

        expect(changesIn(clients.b.channel).map((document) => document.views.map((view) => view.id))).toEqual([['notes', 'main']]);
    });

    test('a new view reaches the other client', async () => {
        const clients = twoClients();
        const { projectId, rev, start } = await openOnBoth(clients);

        await request(clients.a, 'project.save', { projectId, baseRev: rev, content: { ...start, views: [...start.views, canvas('third', 'Third')] } });

        expect(changesIn(clients.b.channel).map((document) => document.views.map((view) => view.id))).toEqual([['main', 'notes', 'third']]);
    });

    test('a save the change made stale finds the document at its client before the refusal', async () => {
        const clients = twoClients();
        const { projectId, rev, start } = await openOnBoth(clients);

        await request(clients.a, 'project.save', { projectId, baseRev: rev, content: { ...start, views: [...start.views, canvas('third', 'Third')] } });
        await expect(request(clients.b, 'project.save', { projectId, baseRev: rev, content: start })).rejects.toThrow(`rev ${rev + 1}`);

        const kinds = clients.b.channel.frames.map((frame) => ('event' in frame ? frame.event : 'reply'));
        expect(kinds).toEqual(['project.changed', 'reply']);
    });
});

describe('an inline chat', () => {
    test('lands as a hidden view in every client of the project and is taken away again on request', async () => {
        const ended: string[] = [];
        const clients = twoClients({ start: async () => undefined, end: async (chatId) => void ended.push(chatId), worktreePaths: async () => [folder] });
        const { projectId } = await openOnBoth(clients);

        const { chatId, viewId } = await request<{ chatId: string; viewId: string }>(clients.a, 'project.newInlineChat', {
            projectId,
            path: 'src/a.ts',
            provider: 'claude'
        });

        const [made] = changesIn(clients.b.channel);
        expect(made?.views.find((view) => view.id === viewId)).toMatchObject({ kind: 'chat', hidden: true });
        expect(chatId).toBe(viewId);

        await request(clients.a, 'project.removeInlineChat', { projectId, viewId });

        expect(ended).toEqual([viewId]);
        expect(
            changesIn(clients.b.channel)
                .at(-1)
                ?.views.map((view) => view.id)
        ).toEqual(['main', 'notes']);
    });

    test('is a request a daemon without chats does not know', async () => {
        const clients = twoClients();
        const { projectId } = await openOnBoth(clients);

        await expect(request(clients.a, 'project.newInlineChat', { projectId, path: 'a.ts', provider: 'claude' })).rejects.toThrow();
    });
});

describe('a client that goes while a project opens', () => {
    test('is not left holding the project once the open lands', async () => {
        const clients = twoClients();
        const opened = await request<{ summary: { projectId: string } }>(clients.b, 'project.open', { folder });
        const projectId = opened.summary.projectId;
        let land = (): void => undefined;
        const landed = new Promise<void>((resolve) => {
            land = resolve;
        });
        const openProject = store.openProject.bind(store);
        store.openProject = async (payload) => {
            await landed;
            return openProject(payload);
        };

        const reply = request(clients.a, 'project.open', { projectId });
        clients.a.channel.drop();
        land();
        await reply;

        expect(store.closing(clients.b.connection.client.id, projectId).otherClients).toBe(0);
    });
});

describe('project identity', () => {
    test('changes a released project without opening it again', async () => {
        const clients = twoClients();
        const opened = await request<{ summary: { projectId: string; lastOpenedAt: number } }>(clients.a, 'project.open', { folder });
        const { projectId, lastOpenedAt } = opened.summary;
        await request(clients.a, 'project.release', { projectId });
        clients.a.channel.frames.length = 0;

        const { summary } = await request<{ summary: { name: string; icon: { kind: string; value: string }; lastOpenedAt: number } }>(
            clients.a,
            'project.setIdentity',
            { projectId, name: 'Renamed', icon: { kind: 'lucide', value: 'rocket' } }
        );

        expect(summary).toMatchObject({ name: 'Renamed', icon: { kind: 'lucide', value: 'rocket' }, lastOpenedAt });
        expect(store.openProjectIds()).toEqual([]);
        expect(changesIn(clients.a.channel).at(-1)).toMatchObject({ name: 'Renamed', icon: { kind: 'lucide', value: 'rocket' } });
    });
});

test('the sidebar request returns open projects without changing the registry', async () => {
    const clients = twoClients();
    const { projectId } = await openOnBoth(clients);
    await request(clients.b, 'project.release', { projectId });
    const before = await store.list();
    const result = await request<import('@ruimte/contracts').ProjectSidebarResult>(clients.b, 'project.sidebar', {});
    expect(result.projects.map((project) => project.summary.projectId)).toContain(projectId);
    expect(result.projects.find((project) => project.summary.projectId === projectId)?.views?.map((view) => view.name)).toEqual(['Main', 'Notes']);
    expect(await store.list()).toEqual(before);
});

test('a new chat reaches a client that has the chats project open', async () => {
    const clients = twoClients();
    const first = await request<{ summary: { projectId: string } }>(clients.a, 'project.newChat', {});
    await request(clients.b, 'project.open', { projectId: first.summary.projectId });
    clients.b.channel.frames.length = 0;

    // Another CLI than the empty chat's, so this makes a chat rather than showing that one again.
    const { viewId } = await request<{ viewId: string }>(clients.a, 'project.newChat', { provider: 'codex' });

    expect(
        changesIn(clients.b.channel)
            .at(-1)
            ?.views.map((view) => view.id)
    ).toContain(viewId);
});
