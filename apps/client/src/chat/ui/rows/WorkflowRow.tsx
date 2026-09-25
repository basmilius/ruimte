import { useTranslation } from 'react-i18next';
import { Bot, ListTree } from 'lucide-react';
import { workflowAgentRef, type ChatToolItem, type ChatWorkflow } from '@ruimte/contracts';
import { workflowAgentTime, workflowPhases, type WorkflowAgentView, type WorkflowPhaseView } from '@/chat/logic/workflow';
import { useSubagentSupport } from '@/chat/subagent-support';
import type { SubagentStep } from '@/chat/subagent-view';
import { ROW_GUTTER } from '@/chat/ui/icons';
import { RunningFor, ToggleLine, WorkLiveRow, WorkRow } from '@/chat/ui/rows/WorkRows';
import { useEndpointId } from '@/state/keys';
import { Icon } from '@/ui/Icon';

function AgentLine({ view, onOpen }: { view: WorkflowAgentView; onOpen?(step: SubagentStep): void }) {
    const { agent, state } = view;
    const time = workflowAgentTime(view);
    const running = state === 'running';
    const agentId = agent.agentId;
    // One still waiting has no transcript yet.
    const open = onOpen !== undefined && agentId !== null ? () => onOpen({ toolUseId: workflowAgentRef(agentId), description: agent.label }) : () => undefined;
    return (
        <ToggleLine
            icon={<Icon icon={Bot} size={12} />}
            label={agent.label}
            detail={running ? (agent.lastTool ?? undefined) : undefined}
            open={false}
            onToggle={open}
            failed={state === 'failed'}
            live={running}
            trailing={
                running && agent.startedAt !== null ? (
                    <RunningFor startedAt={agent.startedAt} />
                ) : (
                    <span className="shrink-0 text-xs text-text-faint tabular-nums">{time}</span>
                )
            }
        />
    );
}

function PhaseBlock({ phase, onOpen }: { phase: WorkflowPhaseView; onOpen?(step: SubagentStep): void }) {
    const { t } = useTranslation('chat');
    return (
        <div>
            {phase.title !== null && (
                <div className="mb-0.5 flex h-7 min-w-0 items-center gap-2 text-xs text-text-muted">
                    <span className={ROW_GUTTER}>
                        <Icon icon={ListTree} size={12} />
                    </span>
                    <span className="min-w-0 truncate">{phase.title}</span>
                    <span className="grow" />
                    {phase.agents.length === 0 && <span className="shrink-0 text-text-faint">{t('rows.workflow.notStarted')}</span>}
                </div>
            )}
            {phase.agents.length > 0 && (
                <div className={phase.title === null ? undefined : 'ml-6'}>
                    {phase.agents.map((view) => (
                        <AgentLine key={view.agent.index} view={view} onOpen={onOpen} />
                    ))}
                </div>
            )}
        </div>
    );
}

/*
 * A Workflow call with the phases its script announced under it, and in each phase the agents it
 * started, in the style of the agents a sub-agent opened. They stay in sight whether the call's own
 * body is open or not; pressing an agent opens its conversation, read from its run's folder.
 */
export function WorkflowRow({ tool, workflow, onOpenAgent }: { tool: ChatToolItem; workflow: ChatWorkflow; onOpenAgent?(step: SubagentStep): void }) {
    const endpointId = useEndpointId();
    // A machine that does not answer `chat.subagent` has no conversation to open for anyone.
    const refused = useSubagentSupport((s) => s.unsupported[endpointId] === true);
    const running = tool.state === 'running';
    const phases = workflowPhases(workflow, running);
    const onOpen = refused ? undefined : onOpenAgent;
    return (
        <div>
            {running ? <WorkLiveRow tool={tool} /> : <WorkRow tool={tool} detail={workflow.name ?? undefined} />}
            {phases.length > 0 && (
                <div className="ml-6">
                    {phases.map((phase) => (
                        <PhaseBlock key={phase.key} phase={phase} onOpen={onOpen} />
                    ))}
                </div>
            )}
        </div>
    );
}
