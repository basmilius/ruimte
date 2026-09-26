import i18next from 'i18next';
import type { ChatSubagentStatus, ChatWorkflow, ChatWorkflowAgent } from '@ruimte/contracts';
import { formatElapsedShort } from '@ruimte/ui/format/duration';

/* `waiting` has not started yet; `stopped` was still at work by the last report when the workflow ended. */
export type WorkflowAgentState = ChatSubagentStatus | 'waiting' | 'stopped';

export interface WorkflowAgentView {
    agent: ChatWorkflowAgent;
    state: WorkflowAgentState;
}

export interface WorkflowPhaseView {
    key: string;
    /* The phase's own title; null for agents outside any phase the script announced. */
    title: string | null;
    agents: WorkflowAgentView[];
}

export const workflowAgentState = (agent: ChatWorkflowAgent, workflowRunning: boolean): WorkflowAgentState => {
    if (agent.status !== 'running') {
        return agent.status;
    }
    if (!workflowRunning) {
        return 'stopped';
    }
    return agent.startedAt === null ? 'waiting' : 'running';
};

/*
 * The phases in the order the script announced them, each with the agents it started in it. A phase
 * announced ahead of its agents is there without any, and agents of no known phase come first, untitled.
 */
export const workflowPhases = (workflow: ChatWorkflow, workflowRunning: boolean): WorkflowPhaseView[] => {
    const known = new Map(workflow.phases.map((phase) => [phase.index, phase]));
    const loose: WorkflowAgentView[] = [];
    const byPhase = new Map<number, WorkflowAgentView[]>();
    for (const agent of workflow.agents) {
        const view = { agent, state: workflowAgentState(agent, workflowRunning) };
        if (agent.phaseIndex === null || !known.has(agent.phaseIndex)) {
            loose.push(view);
            continue;
        }
        byPhase.set(agent.phaseIndex, [...(byPhase.get(agent.phaseIndex) ?? []), view]);
    }
    const phases = workflow.phases.map((phase) => ({ key: `phase-${phase.index}`, title: phase.title, agents: byPhase.get(phase.index) ?? [] }));
    return loose.length > 0 ? [{ key: 'loose', title: null, agents: loose }, ...phases] : phases;
};

/* What the line of an agent that is not at work says about its time; one at work counts on by itself. */
export const workflowAgentTime = (view: WorkflowAgentView): string | null => {
    const duration = view.agent.durationMs === null ? null : formatElapsedShort(view.agent.durationMs);
    switch (view.state) {
        case 'running':
            return null;
        case 'waiting':
            return i18next.t('chat:rows.workflow.waiting');
        case 'stopped':
            return i18next.t('chat:rows.workflow.stopped');
        case 'done':
        case 'failed':
            return duration === null ? i18next.t(`common:status.${view.state}`) : i18next.t(`chat:rows.subagent.${view.state}In`, { duration });
    }
};
