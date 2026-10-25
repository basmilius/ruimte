import { join } from 'node:path';
import { RecordDirectory } from '@adecore/agents';
import { AgentBridgeSchema, isCanvasView, type AgentBridge, type PeerMessagePayload, type RequestMap } from '@ruimte/contracts';
import { RequestError } from '../dispatcher.ts';
import type { MessageHost } from '../canvas/verb.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import type { RemoteConnections } from '../remote/remote-connections.ts';
import { checkedReply } from '../remote/peer-reply.ts';

export interface AgentBridgeDeps {
    home: string;
    projects: Pick<ProjectStore, 'index' | 'remote'>;
    connections: Pick<RemoteConnections, 'connect'>;
    messages: MessageHost;
    fromMessage(nodeId: string): boolean;
}

/* Explicit, person-made grants for two existing agents. Project files and peer-supplied node ids grant nothing. */
export class AgentBridges {
    private readonly files: RecordDirectory<AgentBridge>;
    private readonly deps: AgentBridgeDeps;

    constructor(deps: AgentBridgeDeps) {
        this.deps = deps;
        this.files = new RecordDirectory({ dir: join(deps.home, 'agent-bridges'), schema: AgentBridgeSchema, idOf: (bridge) => bridge.id });
    }

    load(): Promise<void> {
        return this.files.load();
    }

    async wipe(): Promise<void> {
        for (const bridge of this.files.all()) {
            await this.files.remove(bridge.id);
        }
    }

    candidates(projectId: string): { nodeId: string; title: string; canvas: string }[] {
        return (this.deps.projects.index.viewsOf(projectId) ?? []).flatMap((view) =>
            isCanvasView(view) && !view.hidden
                ? view.nodes
                      .filter((node) => node.kind === 'chat' && this.deps.projects.remote.machineOf(projectId, node.id) === null)
                      .map((node) => ({ nodeId: node.id, title: node.title, canvas: view.name }))
                : []
        );
    }

    list(nodeId: string): AgentBridge[] {
        return this.files.all().filter((bridge) => bridge.nodeId === nodeId && this.alive(bridge));
    }

    async bind(bridge: AgentBridge): Promise<void> {
        if (!this.alive(bridge)) {
            throw new RequestError('bridge-node-missing', 'Choose an existing local chat on a visible canvas');
        }
        const held = this.files.get(bridge.id);
        if (this.list(bridge.nodeId).some((row) => row.id !== bridge.id && row.machineId === bridge.machineId && row.remoteNodeId === bridge.remoteNodeId)) {
            throw new RequestError('bridge-exists', 'These agents are already connected');
        }
        if (held !== undefined && JSON.stringify(held) !== JSON.stringify(bridge)) {
            throw new RequestError('bridge-exists', 'That connection already belongs to another pair of agents');
        }
        if (held === undefined && this.list(bridge.nodeId).length >= 32) {
            throw new RequestError('bridge-limit', 'An agent may have at most 32 connections to other machines');
        }
        await this.files.write(bridge);
    }

    async remove(id: string): Promise<void> {
        await this.files.remove(id);
    }

    async send(nodeId: string, id: string, text: string): Promise<{ at: 'now' | 'waiting'; detail: string }> {
        const bridge = this.files.get(id);
        if (bridge === undefined || bridge.nodeId !== nodeId || !this.alive(bridge)) {
            throw new RequestError('bridge-not-linked', 'No person connected this agent to that agent on another machine');
        }
        const link = await this.deps.connections.connect(bridge.machineId);
        const info = checkedReply<RequestMap['endpoint.info']['result']>('endpoint.info', await link.request<unknown>('endpoint.info', {}));
        if (!info.features?.includes('peer.message')) {
            throw new RequestError('bridge-update-required', 'Update Ruimte on the other machine to exchange agent messages');
        }
        // A person may have disconnected the agents while the network was opening.
        if (this.files.get(id) !== bridge || !this.alive(bridge)) {
            throw new RequestError('bridge-not-linked', 'That connection was removed while the other machine was being reached');
        }
        const result = await link.request<unknown>('peer.message', {
            bridgeId: id,
            fromNodeId: nodeId,
            text,
            fromMessage: this.deps.fromMessage(nodeId)
        } satisfies PeerMessagePayload);
        return checkedReply<RequestMap['peer.message']['result']>('peer.message', result);
    }

    async receive(machineId: string, payload: PeerMessagePayload): Promise<{ at: 'now' | 'waiting'; detail: string }> {
        const bridge = this.files.get(payload.bridgeId);
        if (bridge === undefined || bridge.machineId !== machineId || bridge.remoteNodeId !== payload.fromNodeId || !this.alive(bridge)) {
            throw new RequestError('bridge-not-linked', 'No person connected that machine to this agent');
        }
        const result = await this.deps.messages.notify(
            {
                projectId: bridge.projectId,
                targetId: bridge.nodeId,
                from: `bridge:${bridge.id}`,
                fromTitle: bridge.label,
                text: payload.text
            },
            payload.fromMessage
        );
        return { at: result.at, detail: result.detail };
    }

    private alive(bridge: AgentBridge): boolean {
        return this.candidates(bridge.projectId).some((node) => node.nodeId === bridge.nodeId);
    }
}
