import { ActionRefusal, type ActionHandlers } from '@ruimte/actions';
import { isCanvasView, isChatHostView, isDesignView, nodeChats, viewChats, type AgentStatus, type ChatInfo, type SessionInfo } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { agentActivity } from '@/actions/agent-activity';
import { chatWorking, sessionWorking } from '@/state/agent-work';
import { focusedCanvas } from '@/state/canvas';
import { currentEndpointId } from '@/state/current-endpoint';
import { activeDesignChat, placeOfView, shownChatOfNode, useDesignChat } from '@/state/design-chat';
import { activeViewOf, type DocumentState } from '@/state/document';
import { endpointOfNode } from '@/state/keys';
import { useProject } from '@/state/project';
import { nodesOfView } from '@/state/view-nodes';
import { transportFor } from '@/transport';
import { chatClientFor } from '@/transport/connections';

interface ProjectAgent {
    id: string;
    name: string;
    kind: 'chat' | 'terminal';
    viewId: string;
    view: string;
    selected: boolean;
}

/* An agent with the machine it runs on: a node's own, else the workspace's. */
interface PlacedAgent {
    agent: ProjectAgent;
    endpointId: string;
}

function placedAgents(document: StoreApi<DocumentState>): PlacedAgent[] {
    const state = document.getState();
    const active = activeViewOf(state);
    const canvas = active && isCanvasView(active) ? focusedCanvas().getState() : null;
    const workspace = currentEndpointId();
    return state.views.flatMap((view): PlacedAgent[] => {
        if (isDesignView(view)) {
            const shown = activeDesignChat(placeOfView(view), useDesignChat.getState().picked);
            return viewChats(view).map((chat) => ({
                agent: {
                    id: chat.id,
                    name: chat.name,
                    kind: 'chat',
                    viewId: view.id,
                    view: view.name,
                    selected: active?.id === view.id && chat.id === shown
                },
                endpointId: workspace
            }));
        }
        if (isChatHostView(view) || view.kind === 'terminal') {
            return [
                {
                    agent: {
                        id: view.id,
                        name: view.name,
                        kind: view.kind === 'terminal' ? 'terminal' : 'chat',
                        viewId: view.id,
                        view: view.name,
                        selected: active?.id === view.id
                    },
                    endpointId: workspace
                }
            ];
        }
        if (!isCanvasView(view)) {
            return [];
        }
        return nodesOfView(view).flatMap((node): PlacedAgent[] => {
            const selected = view.id === active?.id && canvas?.selection.includes(node.id) === true;
            const endpointId = endpointOfNode(node, workspace);
            if (node.kind === 'terminal') {
                return [{ agent: { id: node.id, name: node.title, kind: 'terminal', viewId: view.id, view: view.name, selected }, endpointId }];
            }
            // A design node's chats are each an agent; the one it shows is the selected one.
            const shown = shownChatOfNode(node);
            return nodeChats(node).map((chat) => ({
                agent: {
                    id: chat.id,
                    name: chat.name,
                    kind: 'chat',
                    viewId: view.id,
                    view: view.name,
                    selected: selected && chat.id === shown
                },
                endpointId
            }));
        });
    });
}

export function projectAgents(document: StoreApi<DocumentState>): ProjectAgent[] {
    return placedAgents(document).map((placed) => placed.agent);
}

type Snapshot = [{ chats: ChatInfo[] }, { sessions: SessionInfo[] }];

/*
 * The chats and sessions of every machine the agents run on, each asked of its own machine; null for one that is not connected
 * or did not answer, so one machine never takes down what the others tell.
 */
async function snapshotsOf(endpointIds: readonly string[], transport: typeof transportFor): Promise<Map<string, Snapshot | null>> {
    const entries = await Promise.all(
        [...new Set(endpointIds)].map(async (endpointId): Promise<[string, Snapshot | null]> => {
            const link = transport(endpointId);
            if (link?.status !== 'open') {
                return [endpointId, null];
            }
            const snapshot = await Promise.all([link.request('chat.list', {}), link.request('session.list', {})]).catch(() => null);
            return [endpointId, snapshot];
        })
    );
    return new Map(entries);
}

interface InspectionDependencies {
    transport: typeof transportFor;
}

export function inspectionActions(document: StoreApi<DocumentState>, dependencies: Partial<InspectionDependencies> = {}): ActionHandlers<void> {
    return {
        'agents.inspect': async () => {
            const placed = placedAgents(document);
            const project = useProject.getState().current?.name ?? 'Untitled project';
            const workspace = currentEndpointId();
            const snapshots = await snapshotsOf([workspace, ...placed.map((entry) => entry.endpointId)], dependencies.transport ?? transportFor);
            const connected = snapshots.get(workspace) != null;
            const agents = placed.flatMap(({ agent: target, endpointId }) => {
                const snapshot = snapshots.get(endpointId) ?? null;
                const chat = snapshot?.[0].chats.find((row) => row.chatId === target.id);
                const session = snapshot?.[1].sessions.find((row) => row.sessionId === target.id);
                if (target.kind === 'terminal' && snapshot && !session?.agent) {
                    return [];
                }
                const status: AgentStatus | 'unknown' = !snapshot
                    ? 'unknown'
                    : target.kind === 'chat'
                      ? (chat?.status ?? 'unknown')
                      : session?.agent?.live
                        ? session.agent.status
                        : session?.agent?.status === 'exited'
                          ? 'exited'
                          : 'unknown';
                return [
                    {
                        ...target,
                        status,
                        working:
                            status === 'unknown'
                                ? null
                                : target.kind === 'chat'
                                  ? chatWorking(chat ? { info: chat } : undefined)
                                  : sessionWorking(session ? { attached: false, agent: session.agent } : undefined),
                        toolHistory: target.kind === 'chat',
                        updatedAt: target.kind === 'terminal' ? (session?.agent?.updatedAt ?? null) : null
                    }
                ];
            });
            return { output: { project, connected, observedAt: Date.now(), agents } };
        },
        'agent.activity': async ({ agentId, limit, toolId }) => {
            const placed = placedAgents(document).find((candidate) => candidate.agent.id === agentId);
            if (!placed) {
                throw new ActionRefusal('unknown-agent', 'The agent does not belong to this project.');
            }
            const target = placed.agent;
            if (target.kind === 'terminal') {
                return { output: { agent: target.name, supported: false, tools: [], truncated: false } };
            }
            const client = chatClientFor(placed.endpointId);
            if (client === null) {
                throw new ActionRefusal('no-machine', `“${target.name}” runs on a machine this client does not know, so nothing was asked.`);
            }
            if ((dependencies.transport ?? transportFor)(placed.endpointId)?.status !== 'open') {
                throw new ActionRefusal('offline', 'The machine is disconnected; current activity is unknown.');
            }
            const snapshot = await client.inspect(agentId);
            const activity = agentActivity(snapshot.items, limit, toolId);
            if (toolId && activity.tools.length === 0) {
                throw new ActionRefusal('tool-not-found', 'That tool call is not in the available recent history. Inspect recent activity first.');
            }
            return { output: { agent: target.name, supported: true, ...activity, truncated: activity.truncated || snapshot.history?.cursor != null } };
        }
    };
}
