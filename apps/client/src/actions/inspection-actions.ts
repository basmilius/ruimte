import { ActionRefusal, type ActionHandlers } from '@ruimte/actions';
import { isCanvasView, isChatHostView, isDesignView, nodeChats, viewChats, type AgentStatus } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { agentActivity } from '@/actions/agent-activity';
import { activeDesignChat, placeOfView, shownChatOfNode, useDesignChat } from '@/design/design-chat';
import { chatWorking, sessionWorking } from '@/state/agent-work';
import { nodesOfView } from '@/project/view-nodes';
import { focusedCanvas } from '@/state/canvas';
import { activeViewOf, type DocumentState } from '@/state/document';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { transportFor } from '@/transport';
import { chatClientFor } from '@/transport/connections';

export function projectAgents(document: StoreApi<DocumentState>) {
    const state = document.getState();
    const active = activeViewOf(state);
    const canvas = active && isCanvasView(active) ? focusedCanvas().getState() : null;
    return state.views.flatMap((view) => {
        if (isDesignView(view)) {
            const shown = activeDesignChat(placeOfView(view), useDesignChat.getState().picked);
            return viewChats(view).map((chat) => ({
                id: chat.id,
                name: chat.name,
                kind: 'chat' as const,
                viewId: view.id,
                view: view.name,
                selected: active?.id === view.id && chat.id === shown
            }));
        }
        if (isChatHostView(view) || view.kind === 'terminal') {
            return [
                {
                    id: view.id,
                    name: view.name,
                    kind: view.kind === 'terminal' ? ('terminal' as const) : ('chat' as const),
                    viewId: view.id,
                    view: view.name,
                    selected: active?.id === view.id
                }
            ];
        }
        if (!isCanvasView(view)) {
            return [];
        }
        return nodesOfView(view).flatMap((node): { id: string; name: string; kind: 'chat' | 'terminal'; viewId: string; view: string; selected: boolean }[] => {
            const selected = view.id === active?.id && canvas?.selection.includes(node.id) === true;
            if (node.kind === 'terminal') {
                return [{ id: node.id, name: node.title, kind: 'terminal', viewId: view.id, view: view.name, selected }];
            }
            // A design node's chats are each an agent; the one it shows is the selected one.
            const shown = shownChatOfNode(node);
            return nodeChats(node).map((chat) => ({
                id: chat.id,
                name: chat.name,
                kind: 'chat' as const,
                viewId: view.id,
                view: view.name,
                selected: selected && chat.id === shown
            }));
        });
    });
}

interface InspectionDependencies {
    transport: typeof transportFor;
}

export function inspectionActions(document: StoreApi<DocumentState>, dependencies: Partial<InspectionDependencies> = {}): ActionHandlers<void> {
    return {
        'agents.inspect': async () => {
            const targets = projectAgents(document);
            const project = useProject.getState().current?.name ?? 'Untitled project';
            const transport = (dependencies.transport ?? transportFor)(currentEndpointId());
            const connected = transport?.status === 'open';
            const snapshot = connected ? await Promise.all([transport.request('chat.list', {}), transport.request('session.list', {})]) : null;
            const agents = targets.flatMap((target) => {
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
            const target = projectAgents(document).find((candidate) => candidate.id === agentId);
            if (!target) {
                throw new ActionRefusal('unknown-agent', 'The agent does not belong to this project.');
            }
            if (target.kind === 'terminal') {
                return { output: { agent: target.name, supported: false, tools: [], truncated: false } };
            }
            const endpointId = currentEndpointId();
            const client = chatClientFor(endpointId);
            if (!client || transportFor(endpointId)?.status !== 'open') {
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
