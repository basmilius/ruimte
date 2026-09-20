import { ActionRefusal, type ActionHandlers } from '@ruimte/actions';
import { isCanvasView, isRecentProject, type AgentStatus } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { agentActivity } from '@/actions/agent-activity';
import type { openProject } from '@/project/open';
import { chatWorking, sessionWorking } from '@/state/agent-work';
import { focusedCanvas } from '@/state/canvas';
import { activeViewOf, type DocumentState } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useProjectList } from '@/state/project-list';
import { transportFor } from '@/transport';
import { chatClientFor } from '@/transport/connections';

export function projectAgents(document: StoreApi<DocumentState>) {
    const state = document.getState();
    const active = activeViewOf(state);
    const canvas = active && isCanvasView(active) ? focusedCanvas().getState() : null;
    return state.views.flatMap((view) => {
        if (view.kind === 'chat' || view.kind === 'terminal') {
            return [{ id: view.id, name: view.name, kind: view.kind, view: view.name, selected: active?.id === view.id }];
        }
        if (!isCanvasView(view)) {
            return [];
        }
        const nodes = view.id === active?.id && canvas ? Object.values(canvas.nodes) : view.nodes;
        return nodes
            .filter((node) => node.kind === 'chat' || node.kind === 'terminal')
            .map((node) => ({
                id: node.id,
                name: node.title,
                kind: node.kind as 'chat' | 'terminal',
                view: view.name,
                selected: view.id === active?.id && canvas?.selection.includes(node.id) === true
            }));
    });
}

export function openVoiceProjects() {
    const current = useProject.getState();
    return useProjectList
        .getState()
        .projects.filter((row) => !isRecentProject(row.summary))
        .map(({ endpointId, summary }) => ({
            endpointId,
            projectId: summary.projectId,
            name: summary.name,
            machine: useEndpoints.getState().endpoints.find((endpoint) => endpoint.id === endpointId)?.label ?? endpointId,
            active: current.currentEndpointId === endpointId && current.current?.projectId === summary.projectId,
            available: summary.available
        }));
}

interface InspectionDependencies {
    switchProject: typeof openProject;
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
                                  ? chatWorking(chat ? { info: chat, items: {}, structure: {}, order: [] } : undefined)
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
        },
        'projects.list-open': () => ({ output: { projects: openVoiceProjects() } }),
        'project.switch': async ({ endpointId, projectId }) => {
            const target = openVoiceProjects().find((row) => row.endpointId === endpointId && row.projectId === projectId);
            if (!target || !target.available) {
                throw new ActionRefusal('project-unavailable', 'Choose an available project from the open project list.');
            }
            const { openProject, projectSwitch } = await import('@/project/open');
            if (!['idle', 'failed'].includes(projectSwitch.store.getState().kind)) {
                throw new ActionRefusal('project-switching', 'Another project switch is in progress. Wait for it to finish.');
            }
            const outcome = await (dependencies.switchProject ?? openProject)(endpointId, projectId);
            if (outcome !== 'done') {
                throw new ActionRefusal('project-switch-failed', `Project switch ${outcome}. Do not claim the target is open.`);
            }
            return { output: { project: target.name, endpointId, projectId } };
        }
    };
}
