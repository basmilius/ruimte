import { ActionRefusal, type ActionInput, type ActionOutput } from '@ruimte/actions';
import { isCanvasView, isOpenableView, isUnknownNode, isUnknownView, type ProjectNode, type ProjectView } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { openVoiceProjects, projectAgents } from '@/actions/inspection-actions';
import { sightOf, visibleNodes } from '@/state/attention';
import { focusedCanvas, type CanvasState } from '@/state/canvas';
import { activeViewOf, type DocumentState } from '@/state/document';

type Resolved = ActionOutput<'target.resolve'>;
type Target = Resolved['found'][number];
type Scope = NonNullable<ActionInput<'target.resolve'>['scope']>;
type Match = { status: 'found'; value: Target } | { status: 'missing' } | { status: 'ambiguous'; candidates: Target[] };

const normalized = (value: string): string =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

/* An exact name wins over a partial one, and more than one of either is the person's to choose. */
const named = (name: string, targets: readonly Target[], label: (target: Target) => string = (target) => target.name): Match => {
    const wanted = normalized(name);
    const exact = targets.filter((target) => normalized(label(target)) === wanted);
    if (exact.length === 1) {
        return { status: 'found', value: exact[0]! };
    }
    if (exact.length > 1) {
        return { status: 'ambiguous', candidates: exact };
    }
    if (wanted === '') {
        return { status: 'missing' };
    }
    const partial = targets.filter((target) => normalized(label(target)).includes(wanted) || wanted.includes(normalized(label(target))));
    if (partial.length === 1) {
        return { status: 'found', value: partial[0]! };
    }
    return partial.length > 1 ? { status: 'ambiguous', candidates: partial } : { status: 'missing' };
};

const byName = (target: Resolved['target'], names: readonly string[], match: (name: string) => Match): Resolved => {
    const found = new Map<string, Target>();
    const ambiguous: Resolved['ambiguous'] = [];
    const missing: string[] = [];
    for (const name of names) {
        const matched = match(name);
        if (matched.status === 'found') {
            found.set(matched.value.id, matched.value);
        } else if (matched.status === 'ambiguous') {
            ambiguous.push({ name, candidates: matched.candidates });
        } else {
            missing.push(name);
        }
    }
    return { target, found: [...found.values()], ambiguous, missing };
};

const current = (target: Resolved['target'], found: Target[]): Resolved => ({ target, found, ambiguous: [], missing: [] });

const placed = { endpointId: null, machine: null };

const viewTarget = (view: ProjectView): Target => ({
    id: view.id,
    name: view.name ?? view.id,
    kind: isUnknownView(view) ? 'unknown' : view.kind,
    viewId: null,
    view: null,
    ...placed
});

const nodeTarget = (node: ProjectNode, view: ProjectView): Target => ({
    id: node.id,
    name: node.title,
    kind: isUnknownNode(node) ? 'unknown' : node.kind,
    viewId: view.id,
    view: view.name ?? view.id,
    ...placed
});

const nodesInScope = (canvas: CanvasState, scope: Scope): ProjectNode[] => {
    if (scope === 'selected') {
        return canvas.selection.map((id) => canvas.nodes[id]).filter((node): node is ProjectNode => node !== undefined);
    }
    const shown = Object.values(canvas.nodes).filter((node) => !canvas.hidden.has(node.id));
    if (scope === 'all') {
        return shown;
    }
    const inSight = new Set(visibleNodes(sightOf(canvas), { readable: false }));
    return shown.filter((node) => inSight.has(node.id));
};

export const resolveTarget = (document: StoreApi<DocumentState>, input: ActionInput<'target.resolve'>): Resolved => {
    const { target, names, nodeKind, scope, machine } = input;
    const state = document.getState();
    const active = activeViewOf(state);
    const canvas = active && isCanvasView(active) ? focusedCanvas().getState() : null;
    if (target === 'view') {
        if (names === null) {
            return current(target, active ? [viewTarget(active)] : []);
        }
        const views = state.views.filter(isOpenableView).map(viewTarget);
        return byName(target, names, (name) => named(name, views));
    }
    if (target === 'node') {
        if (!active || !canvas) {
            throw new ActionRefusal('inactive-canvas', 'Open a canvas before resolving its nodes.');
        }
        const nodes = nodesInScope(canvas, scope ?? (names === null ? 'selected' : 'all'))
            .filter((node) => nodeKind === null || node.kind === nodeKind)
            .map((node) => nodeTarget(node, active));
        return names === null ? current(target, nodes) : byName(target, names, (name) => named(name, nodes));
    }
    if (target === 'chat') {
        if (names === null) {
            if (active?.kind === 'chat') {
                return current(target, [viewTarget(active)]);
            }
            const selected = canvas && active ? nodesInScope(canvas, 'selected').filter((node) => node.kind === 'chat') : [];
            return current(target, active ? selected.map((node) => nodeTarget(node, active)) : []);
        }
        const chats = state.views.flatMap((view) => {
            if (view.kind === 'chat') {
                return [{ ...viewTarget(view), viewId: view.id, view: view.name }];
            }
            if (!isCanvasView(view)) {
                return [];
            }
            const nodes = view.id === active?.id && canvas ? Object.values(canvas.nodes) : view.nodes;
            return nodes.filter((node) => node.kind === 'chat').map((node) => nodeTarget(node, view));
        });
        return byName(target, names, (name) => named(name, chats));
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
            const qualified = named(name, targets, (agent) => `${agent.name} (${agent.view})`);
            return qualified.status === 'found' ? qualified : named(name, targets);
        });
    }
    const projects = openVoiceProjects();
    const projectTargets = (rows: typeof projects): Target[] =>
        rows.map((row) => ({ id: row.projectId, name: row.name, kind: 'project', viewId: null, view: null, endpointId: row.endpointId, machine: row.machine }));
    if (names === null) {
        return current(target, projectTargets(projects.filter((row) => row.active)));
    }
    if (machine === null) {
        return byName(target, names, (name) => named(name, projectTargets(projects)));
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
    const matched: Match = onMachine ? { status: 'found', value: onMachine } : named(machine, machines);
    if (matched.status !== 'found') {
        return {
            target,
            found: [],
            ambiguous: matched.status === 'ambiguous' ? [{ name: machine, candidates: matched.candidates }] : [],
            missing: matched.status === 'missing' ? [machine] : []
        };
    }
    const there = projectTargets(projects.filter((row) => row.endpointId === matched.value.id));
    return byName(target, names, (name) => named(name, there));
};
