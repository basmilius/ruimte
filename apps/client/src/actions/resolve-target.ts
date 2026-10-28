import { ActionRefusal, type ActionInput, type ActionOutput } from '@ruimte/actions';
import {
    isCanvasView,
    isChatHostView,
    isChatNode,
    isDesignView,
    isOpenableView,
    isUnknownNode,
    isUnknownView,
    nodeChats,
    viewChats,
    type ProjectDesignView,
    type ProjectNode,
    type ProjectView,
    type ViewChat
} from '@ruimte/contracts';
import { matchName, resolveNames, type VoiceNameMatch } from '@ruimte/voice';
import type { StoreApi } from 'zustand';
import { projectAgents } from '@/actions/inspection-actions';
import { listedProjects } from '@/actions/project-actions';
import { activeDesignChat, placeOfView, shownChatOfNode, useDesignChat } from '@/design/design-chat';
import { sightOf, visibleNodes } from '@/state/attention';
import { nodesOfView } from '@/project/view-nodes';
import { focusedCanvas, type CanvasState } from '@/state/canvas';
import { activeViewOf, type DocumentState } from '@/state/document';

type Resolved = ActionOutput<'target.resolve'>;
type Target = Resolved['found'][number];
type Scope = NonNullable<ActionInput<'target.resolve'>['scope']>;
type Match = VoiceNameMatch<Target>;

function byName(target: Resolved['target'], names: readonly string[], match: (name: string) => Match): Resolved {
    return { target, ...resolveNames(names, match) };
}

function current(target: Resolved['target'], found: Target[]): Resolved {
    return { target, found, ambiguous: [], missing: [] };
}

const placed = { endpointId: null, machine: null };

/* A chat of a design, which goes by its own name in the design it stands in. */
function designChatTarget(view: ProjectDesignView, chat: ViewChat): Target {
    return { ...viewTarget(view), id: chat.id, name: chat.name, kind: 'chat', viewId: view.id, view: view.name };
}

function viewTarget(view: ProjectView): Target {
    return {
        id: view.id,
        name: view.name ?? view.id,
        kind: isUnknownView(view) ? 'unknown' : view.kind,
        viewId: null,
        view: null,
        ...placed
    };
}

function nodeTarget(node: ProjectNode, view: ProjectView): Target {
    return {
        id: node.id,
        name: node.title,
        kind: isUnknownNode(node) ? 'unknown' : node.kind,
        viewId: view.id,
        view: view.name ?? view.id,
        ...placed
    };
}

/* A chat a node holds as a target: a chat node itself, or one chat of a design node by its own id and name. */
function nodeChatTarget(node: ProjectNode, chatId: string, view: ProjectView): Target {
    const chat = nodeChats(node).find((candidate) => candidate.id === chatId);
    return { ...nodeTarget(node, view), id: chatId, name: chat?.name ?? node.title, kind: 'chat' };
}

function nodesInScope(canvas: CanvasState, scope: Scope): ProjectNode[] {
    if (scope === 'selected') {
        return canvas.selection.map((id) => canvas.nodes[id]).filter((node): node is ProjectNode => node !== undefined);
    }
    const shown = Object.values(canvas.nodes).filter((node) => !canvas.hidden.has(node.id));
    if (scope === 'all') {
        return shown;
    }
    const inSight = new Set(visibleNodes(sightOf(canvas), { readable: false }));
    return shown.filter((node) => inSight.has(node.id));
}

export function resolveTarget(document: StoreApi<DocumentState>, input: ActionInput<'target.resolve'>): Resolved {
    const { target, names, nodeKind, scope, machine } = input;
    const state = document.getState();
    const active = activeViewOf(state);
    const canvas = active && isCanvasView(active) ? focusedCanvas().getState() : null;
    if (target === 'view') {
        if (names === null) {
            return current(target, active ? [viewTarget(active)] : []);
        }
        const views = state.views.filter(isOpenableView).map(viewTarget);
        return byName(target, names, (name) => matchName(name, views));
    }
    if (target === 'node') {
        if (!active || !canvas) {
            throw new ActionRefusal('inactive-canvas', 'Open a canvas before resolving its nodes.');
        }
        const nodes = nodesInScope(canvas, scope ?? (names === null ? 'selected' : 'all'))
            .filter((node) => nodeKind === null || node.kind === nodeKind)
            .map((node) => nodeTarget(node, active));
        return names === null ? current(target, nodes) : byName(target, names, (name) => matchName(name, nodes));
    }
    if (target === 'chat') {
        if (names === null) {
            if (active && isDesignView(active)) {
                const chatId = activeDesignChat(placeOfView(active), useDesignChat.getState().picked);
                return current(target, [
                    designChatTarget(
                        active,
                        viewChats(active).find((chat) => chat.id === chatId)!
                    )
                ]);
            }
            if (active && isChatHostView(active)) {
                return current(target, [viewTarget(active)]);
            }
            const selected = canvas && active ? nodesInScope(canvas, 'selected').filter(isChatNode) : [];
            return current(target, active ? selected.map((node) => nodeChatTarget(node, shownChatOfNode(node)!, active)) : []);
        }
        const chats = state.views.flatMap((view) => {
            if (isDesignView(view)) {
                return viewChats(view).map((chat) => designChatTarget(view, chat));
            }
            if (isChatHostView(view)) {
                return [{ ...viewTarget(view), viewId: view.id, view: view.name }];
            }
            if (!isCanvasView(view)) {
                return [];
            }
            return nodesOfView(view).flatMap((node) => nodeChats(node).map((chat) => nodeChatTarget(node, chat.id, view)));
        });
        return byName(target, names, (name) => matchName(name, chats));
    }
    if (target === 'agent') {
        const agents = projectAgents(document);
        const agentTarget = (agent: (typeof agents)[number]): Target => ({
            id: agent.id,
            name: agent.name,
            kind: agent.kind,
            viewId: agent.viewId,
            view: agent.view,
            ...placed
        });
        const targets = agents.map(agentTarget);
        if (names === null) {
            return current(target, agents.filter((agent) => agent.selected).map(agentTarget));
        }
        return byName(target, names, (name) => {
            const exact = targets.find((agent) => agent.id === name);
            if (exact) {
                return { status: 'found', value: exact };
            }
            const qualified = matchName(name, targets, (agent) => `${agent.name} (${agent.view})`);
            return qualified.status === 'found' ? qualified : matchName(name, targets);
        });
    }
    const projects = listedProjects();
    const projectTargets = (rows: typeof projects): Target[] =>
        rows.map((row) => ({ id: row.projectId, name: row.name, kind: 'project', viewId: null, view: null, endpointId: row.endpointId, machine: row.machine }));
    // A project in use wins over one under Recent that shares its name.
    const inUseFirst = (rows: typeof projects) => (name: string) => {
        const open = matchName(name, projectTargets(rows.filter((row) => !row.recent)));
        return open.status === 'missing' ? matchName(name, projectTargets(rows)) : open;
    };
    if (names === null) {
        return current(target, projectTargets(projects.filter((row) => row.active)));
    }
    if (machine === null) {
        return byName(target, names, inUseFirst(projects));
    }
    const machines: Target[] = [...new Map(projects.map((row) => [row.endpointId, row.machine])).entries()].map(([endpointId, label]) => ({
        id: endpointId,
        name: label,
        kind: 'machine',
        viewId: null,
        view: null,
        endpointId,
        machine: label
    }));
    const onMachine = machines.find((row) => row.id === machine) ?? null;
    const matched: Match = onMachine ? { status: 'found', value: onMachine } : matchName(machine, machines);
    if (matched.status !== 'found') {
        return {
            target,
            found: [],
            ambiguous: matched.status === 'ambiguous' ? [{ name: machine, candidates: matched.candidates }] : [],
            missing: matched.status === 'missing' ? [machine] : []
        };
    }
    return byName(target, names, inUseFirst(projects.filter((row) => row.endpointId === matched.value.id)));
}
