import { useTranslation } from 'react-i18next';
import { Bot, ListTree, TriangleAlert, Square } from 'lucide-react';
import { workflowAgentRef, type ChatToolItem, type ChatWorkflow } from '@ruimte/agent-contracts';
import { workflowAgentTime, workflowPhases, type WorkflowAgentView, type WorkflowPhaseView } from '../../logic/workflow';
import { useSubagentSupport } from '../../subagent-support';
import type { SubagentStep } from '../../subagent-view';
import { ROW_GUTTER } from '../icons';
import { RunningFor, ToggleLine, WorkLiveRow, WorkRow } from './WorkRows';
import { useChatScope } from '../../../scope';
import { Icon, IconButton } from '@basmilius/desktop-ui';
import { useChatActions } from '../../actions';
import { chatHost } from '../../../host';

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
    const { t } = useTranslation('agent-chat');
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

// Keep background progress visible after the launcher turn ends.
export function WorkflowRow({
    tool,
    workflow,
    chatId,
    onOpenAgent
}: {
    tool: ChatToolItem;
    workflow: ChatWorkflow;
    chatId?: string;
    onOpenAgent?(step: SubagentStep): void;
}) {
    const { t } = useTranslation('agent-chat');
    const { id } = useChatScope();
    // A host that does not answer `chat.subagent` has no conversation to open for anyone.
    const refused = useSubagentSupport((s) => s.unsupported[id] === true);
    const running = tool.state === 'running';
    const phases = workflowPhases(workflow, running);
    const onOpen = refused ? undefined : onOpenAgent;
    const actions = useChatActions();
    const stop = (): void => {
        if (chatId && workflow.taskId) {
            void actions.stopTask(chatId, workflow.taskId).catch((error: unknown) => {
                chatHost().notify({
                    kind: 'error',
                    title: t('activity.stopFailed'),
                    description: error instanceof Error ? error.message : t('subagents.noAnswer')
                });
            });
        }
    };
    return (
        <div>
            <div className="flex items-center gap-1">
                <div className="min-w-0 grow">{running ? <WorkLiveRow chatId={chatId ?? ''} tool={tool} /> : <WorkRow tool={tool} detail={workflow.name ?? undefined} />}</div>
                {running && chatId && workflow.taskId && <IconButton icon={Square} size="xs" label={t('activity.stop')} onClick={stop} />}
            </div>
            {running && workflow.stalledAt !== undefined && (
                <p role="status" className="ml-6 mb-1 flex items-start gap-1.5 text-xs text-text-muted">
                    <Icon icon={TriangleAlert} size={12} className="mt-0.5 shrink-0 text-status-needs-you" />
                    <span>{t('rows.workflow.stalled')}</span>
                </p>
            )}
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
