import { create } from 'zustand';
import type { SubagentStep, SubagentTrail } from '@adecore/agents-react/chat';

/* What a person chose for one workflow beside a chat node. */
export interface WorkflowSelection {
    /* Undefined follows the live phase, null keeps every phase closed, a key keeps that phase open. */
    openPhase?: string | null;
    /* The agent whose conversation is open beside the phases, by its index in the workflow, with the way down from it. */
    agent?: { index: number; trail: SubagentTrail };
}

export interface WorkflowBesideState {
    /* The workflow a person switched to; absent shows the newest that runs. */
    picked?: string;
    /* The workflows a person put away, so a new one still shows. */
    dismissed: readonly string[];
    /* Under the workflow's own id, so a phase or an agent never carries over to another workflow. */
    workflows: Readonly<Record<string, WorkflowSelection>>;
}

const EMPTY: WorkflowBesideState = { dismissed: [], workflows: {} };

/*
 * What the cards beside a chat node show, by the machine, the view and the node: this window's alone,
 * like the scroll of a node, in memory and never in the project. A reload starts from the live phase.
 */
const useBesideStore = create<{ byKey: Readonly<Record<string, WorkflowBesideState>> }>(() => ({ byKey: {} }));

export function besideKey(endpointId: string, viewId: string, nodeId: string): string {
    return `${endpointId}\n${viewId}\n${nodeId}`;
}

export function useWorkflowBeside(key: string): WorkflowBesideState {
    return useBesideStore((s) => s.byKey[key] ?? EMPTY);
}

export function readWorkflowBeside(key: string): WorkflowBesideState {
    return useBesideStore.getState().byKey[key] ?? EMPTY;
}

function update(key: string, change: (state: WorkflowBesideState) => WorkflowBesideState): void {
    useBesideStore.setState((s) => {
        const current = s.byKey[key] ?? EMPTY;
        const next = change(current);
        return next === current ? s : { byKey: { ...s.byKey, [key]: next } };
    });
}

function updateWorkflow(key: string, workflowId: string, change: (selection: WorkflowSelection) => WorkflowSelection): void {
    update(key, (state) => ({ ...state, workflows: { ...state.workflows, [workflowId]: change(state.workflows[workflowId] ?? {}) } }));
}

export function pickWorkflow(key: string, workflowId: string): void {
    update(key, (state) => ({ ...state, picked: workflowId }));
}

export function dismissWorkflows(key: string, workflowIds: readonly string[]): void {
    update(key, (state) => ({ ...state, dismissed: [...new Set([...state.dismissed, ...workflowIds])] }));
}

export function showWorkflows(key: string): void {
    update(key, (state) => (state.dismissed.length === 0 ? state : { ...state, dismissed: [] }));
}

/* A phase a person opened or closed; from then on the cards stop following the live one for this workflow. */
export function openWorkflowPhase(key: string, workflowId: string, phase: string | null): void {
    updateWorkflow(key, workflowId, (selection) => ({ ...selection, openPhase: phase }));
}

export function openWorkflowAgent(key: string, workflowId: string, index: number, step: SubagentStep): void {
    updateWorkflow(key, workflowId, (selection) => ({ ...selection, agent: { index, trail: [step] } }));
}

/* The way down from the open agent to the conversation its card shows: one step further for a child it opened, one fewer back up. */
export function setWorkflowAgentTrail(key: string, workflowId: string, trail: SubagentTrail): void {
    updateWorkflow(key, workflowId, (selection) =>
        selection.agent === undefined || trail.length === 0 ? selection : { ...selection, agent: { ...selection.agent, trail } }
    );
}

export function closeWorkflowAgent(key: string, workflowId: string): void {
    updateWorkflow(key, workflowId, ({ agent: _agent, ...selection }) => selection);
}

/* Forgets the choices about workflows the chat no longer speaks of, so the store does not grow with every run. */
export function pruneWorkflowBeside(key: string, workflowIds: readonly string[]): void {
    update(key, (state) => {
        const known = new Set(workflowIds);
        const workflows = Object.fromEntries(Object.entries(state.workflows).filter(([id]) => known.has(id)));
        const dismissed = state.dismissed.filter((id) => known.has(id));
        const picked = state.picked !== undefined && known.has(state.picked) ? state.picked : undefined;
        const same =
            Object.keys(workflows).length === Object.keys(state.workflows).length && dismissed.length === state.dismissed.length && picked === state.picked;
        return same ? state : { dismissed, workflows, ...(picked === undefined ? {} : { picked }) };
    });
}

/* Drops what was held for the nodes the canvas no longer has. */
export function forgetWorkflowBeside(matches: (key: string) => boolean): void {
    useBesideStore.setState((s) => {
        const kept = Object.entries(s.byKey).filter(([key]) => !matches(key));
        return kept.length === Object.keys(s.byKey).length ? s : { byKey: Object.fromEntries(kept) };
    });
}

/* Whether a chat node shows its workflows beside it, for the node's menu, which puts every one away or brings them back. */
export function useWorkflowBesideSwitch(
    endpointId: string,
    viewId: string | null,
    nodeId: string,
    workflowIds: readonly string[]
): { shown: boolean; toggle(): void } | null {
    const key = besideKey(endpointId, viewId ?? '', nodeId);
    const dismissed = useBesideStore((s) => s.byKey[key]?.dismissed ?? EMPTY.dismissed);
    if (viewId === null || workflowIds.length === 0) {
        return null;
    }
    const shown = workflowIds.some((id) => !dismissed.includes(id));
    return { shown, toggle: () => (shown ? dismissWorkflows(key, workflowIds) : showWorkflows(key)) };
}
