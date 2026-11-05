import { describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectView, RemoteLink } from '@ruimte/contracts';
import type { CanvasNode } from '@/state/canvas';
import { RemoteMirror, remoteMirrorsOf, type RemoteMirrorHost } from './remote-mirror';

const SELF = 'machine-a';
const B = 'machine-b';

function node(id: string, kind: CanvasNode['kind'], machine?: string): CanvasNode {
    return { id, kind, title: id, x: 0, y: 0, w: 100, h: 100, ...(machine === undefined ? {} : { machine }) } as CanvasNode;
}

function canvas(nodes: CanvasNode[], edges: ProjectCanvasView['edges'] = []): ProjectCanvasView {
    return { kind: 'canvas', id: 'main', name: 'Main', nodes, texts: [], edges, layouts: [] };
}

const nodesOf = (view: ProjectView): readonly CanvasNode[] => (view.kind === 'canvas' ? (view.nodes as CanvasNode[]) : []);

describe('what each machine draws of a project', () => {
    test('a line between a chat and a device that both run on one machine goes there', () => {
        const view = canvas(
            [node('chat', 'chat', B), node('phone', 'device', B), node('here', 'terminal')],
            [{ id: 'e1', from: 'chat', to: 'phone', role: 'target' }]
        );
        const mirrors = remoteMirrorsOf([view], nodesOf, SELF);
        expect([...mirrors.keys()]).toEqual([B]);
        expect(mirrors.get(B)!.nodes.map((entry) => entry.id)).toEqual(['chat', 'phone']);
        expect(mirrors.get(B)!.edges.map((edge) => edge.id)).toEqual(['e1']);
    });

    test('a line from a node here to a node there goes to nobody', () => {
        const view = canvas([node('chat', 'chat', B), node('here', 'terminal')], [{ id: 'e1', from: 'here', to: 'chat' }]);
        expect(remoteMirrorsOf([view], nodesOf, SELF).get(B)!.edges).toEqual([]);
    });

    test('keeps what the other machine starts from and nothing of this canvas', () => {
        const view = canvas([{ ...node('shell', 'terminal', B), cwd: '/work', resume: 'session', account: 'a', x: 40 } as CanvasNode]);
        expect(remoteMirrorsOf([view], nodesOf, SELF).get(B)!.nodes).toEqual([{ id: 'shell', kind: 'terminal', title: 'shell', cwd: '/work' }]);
    });
});

/* A window with one project, a machine to talk to and the stores a change comes from. */
function rig(views: () => ProjectView[], links: RemoteLink[] = [{ machineId: B, remoteProjectId: 'remote-1', label: 'MacBook Pro', rootCommit: 'abc' }]) {
    const renewed: string[] = [];
    const sent: Array<{ type: string; payload: unknown }> = [];
    let changed: (() => void) | null = null;
    let status: 'open' | 'closed' = 'open';
    const statusHandlers = new Set<(status: 'open' | 'closed') => void>();
    const transport = {
        get status() {
            return status;
        },
        request: async (type: string, payload: unknown) => {
            sent.push({ type, payload });
            return {};
        },
        subscribeStatus: (handler: (status: 'open' | 'closed') => void) => {
            statusHandlers.add(handler);
            return () => statusHandlers.delete(handler);
        }
    };
    const host: RemoteMirrorHost = {
        projectId: () => 'project-1',
        selfId: () => SELF,
        views,
        nodesOf,
        subscribe: (listener) => {
            changed = listener;
            return () => {
                changed = null;
            };
        },
        links: async () => links,
        transportOf: () => transport as never,
        renewPeer: async (machineId) => void renewed.push(machineId)
    };
    const mirror = new RemoteMirror(host);
    return {
        mirror,
        renewed,
        sent,
        change: () => changed?.(),
        setStatus(next: 'open' | 'closed') {
            status = next;
            statusHandlers.forEach((handler) => handler(next));
        }
    };
}

describe('the copy on the other machine', () => {
    test('has the machine renew its right to work here once it shows nodes of this window, and not for an empty copy', async () => {
        let nodes: CanvasNode[] = [];
        const { mirror, renewed, change } = rig(() => [canvas(nodes)]);
        mirror.start();
        await mirror.settled();
        expect(renewed).toEqual([]);
        nodes = [node('chat', 'chat', B)];
        change();
        await mirror.settled();
        expect(renewed).toEqual([B]);
    });

    test('is sent once per change, however many changes land in one turn', async () => {
        let nodes = [node('chat', 'chat', B)];
        const { mirror, sent, change } = rig(() => [canvas(nodes)]);
        mirror.start();
        await mirror.settled();
        expect(sent.map((request) => request.type)).toEqual(['peer.placeNodes']);
        expect(sent[0]!.payload).toMatchObject({ machineId: SELF, projectId: 'remote-1' });

        nodes = [node('chat', 'chat', B), node('shell', 'terminal', B)];
        change();
        change();
        change();
        await mirror.settled();
        expect(sent.map((request) => request.type)).toEqual(['peer.placeNodes', 'peer.placeNodes']);
        // Nothing changed for the machine, so nothing is sent for the same document.
        change();
        await mirror.settled();
        expect(sent).toHaveLength(2);
    });

    test('says so when the last node left, and has nothing to say to a machine it never told', async () => {
        let nodes = [node('chat', 'chat', B)];
        const { mirror, sent, change } = rig(() => [canvas(nodes)]);
        mirror.start();
        await mirror.settled();
        nodes = [];
        change();
        await mirror.settled();
        expect(sent[1]!.payload).toMatchObject({ nodes: [], edges: [] });

        const idle = rig(() => [canvas([node('here', 'terminal')])]);
        idle.mirror.start();
        await idle.mirror.settled();
        expect(idle.sent).toEqual([]);
    });

    test('is sent again when the link of the machine comes back', async () => {
        const { mirror, sent, setStatus } = rig(() => [canvas([node('chat', 'chat', B)])]);
        mirror.start();
        await mirror.settled();
        setStatus('closed');
        setStatus('open');
        await mirror.settled();
        expect(sent.map((request) => request.type)).toEqual(['peer.placeNodes', 'peer.placeNodes']);
    });

    test('waits for a link to a checkout, and sends nothing without one', async () => {
        const { mirror, sent } = rig(() => [canvas([node('chat', 'chat', B)])], []);
        mirror.start();
        await mirror.settled();
        expect(sent).toEqual([]);
    });

    test('closing the project ends the nodes it drew on every machine that holds a copy and releases it, and never closes it there; leaving only releases it', async () => {
        const { mirror, sent } = rig(() => [canvas([node('chat', 'chat', B)])]);
        mirror.start();
        await mirror.settled();
        await mirror.close();
        expect(sent.slice(-2)).toEqual([
            { type: 'peer.placeNodes', payload: { machineId: SELF, projectId: 'remote-1', nodes: [], edges: [] } },
            { type: 'project.release', payload: { projectId: 'remote-1' } }
        ]);
        expect(sent.some((request) => request.type === 'project.close')).toBe(false);

        const leaving = rig(() => [canvas([node('chat', 'chat', B)])]);
        leaving.mirror.start();
        await leaving.mirror.settled();
        leaving.mirror.release();
        await Promise.resolve();
        expect(leaving.sent.at(-1)).toEqual({ type: 'project.release', payload: { projectId: 'remote-1' } });
    });

    test('linked to another project there, lets the old one go and sends the nodes to the new one', async () => {
        const links: RemoteLink[] = [{ machineId: B, remoteProjectId: 'remote-1', label: 'MacBook Pro', rootCommit: 'abc' }];
        const { mirror, sent } = rig(() => [canvas([node('chat', 'chat', B)])], links);
        mirror.start();
        await mirror.settled();
        links[0] = { ...links[0]!, remoteProjectId: 'remote-2' };
        sent.length = 0;

        await mirror.relink(B, 'remote-2');
        await mirror.settled();

        expect(sent.map((request) => [request.type, (request.payload as { projectId: string }).projectId])).toEqual([
            ['peer.placeNodes', 'remote-1'],
            ['project.release', 'remote-1'],
            ['peer.placeNodes', 'remote-2']
        ]);
        expect((sent[2]!.payload as { nodes: unknown[] }).nodes).toHaveLength(1);
    });

    test('linked again to the same project there, only reads the link anew and sends the nodes again', async () => {
        const { mirror, sent } = rig(() => [canvas([node('chat', 'chat', B)])]);
        mirror.start();
        await mirror.settled();
        sent.length = 0;

        await mirror.relink(B, 'remote-1');
        await mirror.settled();

        expect(sent.map((request) => request.type)).toEqual(['peer.placeNodes']);
    });
});
