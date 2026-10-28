import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ArrowLeft, ChevronLeft, ChevronRight, CloudOff, MessageSquareText, Square, TriangleAlert, Workflow, X } from 'lucide-react';
import { nodeColorOf, workflowEndedAt, type AgentKind, type ChatWorkflow } from '@ruimte/contracts';
import {
    jumpToTimelineItem,
    liveWorkflowPhase,
    useChatActions,
    useSubagentSupport,
    workflowAgentState,
    workflowAgentTime,
    workflowCounts,
    workflowDescription,
    workflowPhases,
    workflowPhaseState,
    workflowPhaseTime,
    type WorkflowAgentView,
    type WorkflowPhaseStateKind,
    type WorkflowPhaseView
} from '@adecore/agents-react/chat';
import { SubagentTimeline, WorkflowAgentLine } from '@adecore/agents-react/chat/ui';
import { useChatRow } from '@adecore/agents-react/state';
import { useChatScope } from '@adecore/agents-react';
import { ErrorBoundary, Icon, IconButton, Tooltip, messageOf, useTickingText } from '@adecore/ui';
import { formatElapsedShort } from '@adecore/ui/format';
import { accentColor, accentHeaderStyle, accentShades } from '@/canvas/accents';
import { CHROME_H, FRAME, frameStyle, HEADER, HEADER_MIDDLE } from '@/canvas/derived-card-look';
import { CardLine } from '@/canvas/DerivedCardLook';
import { DerivedSet, type DerivedCard } from '@/canvas/DerivedSet';
import { KindIcon } from '@/canvas/KindIcon';
import type { Rect } from '@/canvas/math';
import { derivedCardId } from '@/canvas/node-body';
import type { ResizeEdge } from '@/canvas/resize-handles';
import { shownWorkflow, workflowCandidates, type WorkflowCandidate } from '@/chat/workflow/beside-workflows';
import {
    besideKey,
    closeWorkflowAgent,
    dismissWorkflows,
    openWorkflowAgent,
    openWorkflowPhase,
    pickWorkflow,
    pruneWorkflowBeside,
    setWorkflowAgentTrail,
    useWorkflowBeside
} from '@/chat/workflow/workflow-beside-state';
import { phaseCardKey, workflowBesideLayout, type WorkflowBesideCard } from '@/chat/workflow/workflow-beside-layout';
import { AGENT_MIN, storedAgentSize } from '@/chat/workflow/workflow-size';
import type { CardSize } from '@/routines/output-size';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { endpointKey, useEndpointId } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { useEndpointConnection } from '@/transport/status';

const NONE: readonly WorkflowCandidate[] = [];

/* The card is placed by its top-left corner beside the phases, so only its right and bottom edges move. */
const AGENT_EDGES: readonly ResizeEdge[] = ['e', 's', 'se'];

/* The semantic colors a status keeps on any accent. */
const PHASE_DOT: Record<WorkflowPhaseStateKind, string> = {
    running: 'bg-status-running',
    waiting: 'border border-border-strong',
    done: 'bg-status-idle',
    failed: 'bg-status-error'
};

const TIME = 'shrink-0 text-xs text-text-muted tabular-nums';

function Elapsed({ startedAt }: { startedAt: number }) {
    const ref = useTickingText(() => formatElapsedShort(Date.now() - startedAt));
    return <span ref={ref} className={TIME} />;
}

function PhaseDot({ state }: { state: WorkflowPhaseStateKind }) {
    return <span aria-hidden className={clsx('size-2 shrink-0 rounded-full', PHASE_DOT[state])} />;
}

/* How long a phase's agents were at work, counting on while one is. */
function PhaseTime({ phase }: { phase: WorkflowPhaseView }) {
    const time = workflowPhaseTime(phase);
    if (time === null) {
        return null;
    }
    return time.endedAt === null ? <Elapsed startedAt={time.startedAt} /> : <span className={TIME}>{formatElapsedShort(time.endedAt - time.startedAt)}</span>;
}

function phaseTitle(phase: WorkflowPhaseView, loose: string): string {
    return phase.title ?? loose;
}

/*
 * A running workflow of a chat node, beside that node on the canvas: a line that sums it up, a card
 * per phase with at most one open, and once a person picks an agent its conversation. Everything is
 * read from the chat's row as the node's own body holds it, and nothing is stored in the project;
 * which phase or agent is open is this window's (`workflow-beside-state.ts`). `stale` says the machine
 * is not connected, so what shows is the last that was known.
 */
export function WorkflowBeside({ id, z }: { id: string; z: number }) {
    const { t } = useTranslation('canvas');
    const node = useCanvas((s) => s.nodes[id]);
    const viewId = useCanvas((s) => s.viewId);
    const canvasStore = useCanvasStore();
    const endpointId = useEndpointId();
    const connection = useEndpointConnection(endpointId);
    const scope = useChatScope();
    const candidates = useChatRow(id, (row) => (row === undefined ? NONE : workflowCandidates(row)));
    const provider = useChatRow(id, (row) => row?.info.provider);
    const key = besideKey(endpointId, viewId ?? '', id);
    const beside = useWorkflowBeside(key);
    // A host that does not answer `chat.subagent` has no conversation to open for anyone.
    const refused = useSubagentSupport((s) => s.unsupported[scope.id] === true);
    const actions = useChatActions();
    const [openHeights, setOpenHeights] = useState<Readonly<Record<string, number>>>({});
    const [agentSize, setAgentSize] = useState<CardSize | null>(() => (viewId === null ? null : storedAgentSize(viewId, id).read()));
    /*
     * The workflow a stop was asked for and the report it was pressed on. The machine answers once it
     * passed the stop on, not once the workflow ended, so the stop stays pending until the workflow
     * reports again: an ended one goes, and one that still runs offers Stop again.
     */
    const [stopping, setStopping] = useState<{ id: string; workflow: ChatWorkflow; sent: boolean } | null>(null);
    // Where the keyboard goes back to once the agent's card closed, which is only drawn after the change.
    const focusAfterClose = useRef<{ phase: string; index: number } | null>(null);

    useEffect(() => {
        pruneWorkflowBeside(
            key,
            candidates.map((candidate) => candidate.id)
        );
    }, [key, candidates]);

    useEffect(() => {
        const target = focusAfterClose.current;
        if (target === null) {
            return;
        }
        focusAfterClose.current = null;
        const cardId = derivedCardId(id, phaseCardKey(target.phase));
        const card = document.querySelector(`[data-derived-card="${CSS.escape(cardId)}"]`);
        // The agent's own line when its phase is open, or else the phase itself.
        const line = card?.querySelector<HTMLElement>(`[data-workflow-agent="${target.index}"]`) ?? card?.querySelector<HTMLElement>('button');
        if (line) {
            canvasStore.getState().focusCard(cardId);
            line.focus({ preventScroll: true });
        }
    });

    if (node === undefined || viewId === null) {
        return null;
    }
    const shown = shownWorkflow(candidates, beside.picked, beside.dismissed);
    if (shown === null) {
        return null;
    }
    const { candidate } = shown;
    const { workflow, tool, running } = candidate;
    const stale = connection.status !== 'open';
    const selection = beside.workflows[candidate.id] ?? {};
    const phases = workflowPhases(workflow, running);
    const live = liveWorkflowPhase(phases, running);
    const openPhase = selection.openPhase === undefined ? live : phases.some((phase) => phase.key === selection.openPhase) ? selection.openPhase : null;
    const picked = selection.agent;
    const agentPhase = picked === undefined || refused ? undefined : phases.find((phase) => phase.agents.some((view) => view.agent.index === picked.index));
    const pickedView = agentPhase?.agents.find((view) => view.agent.index === picked?.index);
    // The color a person gave the node, which every card beside it wears as the node's own frame does.
    const accent = accentColor(nodeColorOf(node));
    const loose = t('workflowBeside.phase.loose');
    const title = workflow.name ?? workflowDescription(tool.input) ?? t('workflowBeside.summary');

    const stopPending = running && stopping?.id === candidate.id && (!stopping.sent || stopping.workflow === workflow);

    const stop = (): void => {
        const taskId = workflow.taskId;
        if (taskId === undefined || stopPending) {
            return;
        }
        const asked = { id: candidate.id, workflow, sent: false };
        setStopping(asked);
        actions.stopTask(id, taskId).then(
            () => setStopping((last) => (last === asked ? { ...asked, sent: true } : last)),
            (e: unknown) => {
                setStopping((last) => (last === asked ? null : last));
                useToasts.getState().show({ kind: 'error', title: t('workflowBeside.stopFailed'), description: messageOf(e) });
            }
        );
    };
    const closeAgent = (): void => {
        if (picked !== undefined && agentPhase !== undefined) {
            focusAfterClose.current = { phase: agentPhase.key, index: picked.index };
        }
        closeWorkflowAgent(key, candidate.id);
    };
    const resizeAgent = ({ w, h }: Rect): void => {
        setAgentSize({ w, h });
        storedAgentSize(viewId, id).write({ w, h });
    };

    const cardContent = (card: WorkflowBesideCard): { label: string; body: ReactNode } => {
        if (card.kind === 'summary') {
            return {
                label: title,
                body: (
                    <Summary
                        candidate={candidate}
                        title={title}
                        accent={accent}
                        stale={stale}
                        stopping={stopPending}
                        position={shown.count > 1 ? { index: shown.index, count: shown.count } : null}
                        onSwitch={(step) => pickWorkflow(key, shown.shown[(shown.index + step + shown.count) % shown.count]!.id)}
                        onStop={stop}
                        onDismiss={() => dismissWorkflows(key, [candidate.id])}
                        onShowInChat={() =>
                            jumpToTimelineItem(endpointKey(endpointId, id), tool.id, {
                                flash: true,
                                onMissing: () => useToasts.getState().show({ kind: 'error', title: t('workflowBeside.notInChat') })
                            })
                        }
                    />
                )
            };
        }
        if (card.kind === 'phase') {
            const phase = phases.find((candidatePhase) => candidatePhase.key === card.phase)!;
            const label = phaseTitle(phase, loose);
            return {
                label,
                body: card.open ? (
                    <OpenPhase
                        phase={phase}
                        title={label}
                        accent={accent}
                        provider={provider}
                        refused={refused}
                        pickedIndex={agentPhase?.key === phase.key ? picked?.index : undefined}
                        onPick={(view, step) => openWorkflowAgent(key, candidate.id, view.agent.index, step)}
                        onCollapse={() => openWorkflowPhase(key, candidate.id, null)}
                        onMeasure={(h) => setOpenHeights((last) => (last[phase.key] === h ? last : { ...last, [phase.key]: h }))}
                    />
                ) : (
                    <PhaseLine phase={phase} title={label} accent={accent} onOpen={() => openWorkflowPhase(key, candidate.id, phase.key)} />
                )
            };
        }
        const view = pickedView!;
        const trail = picked!.trail;
        return {
            label: view.agent.label,
            body: (
                <AgentCard
                    chatId={id}
                    view={workflowAgentView(workflow, view, running)}
                    trail={trail}
                    accent={accent}
                    onBack={() => setWorkflowAgentTrail(key, candidate.id, trail.slice(0, -1))}
                    onOpenChild={(step) => setWorkflowAgentTrail(key, candidate.id, [...trail, step])}
                    onClose={closeAgent}
                />
            )
        };
    };

    const layout = workflowBesideLayout(
        node,
        { phases: phases.map((phase) => phase.key), openPhase, agentPhase: pickedView === undefined ? null : agentPhase!.key },
        { openHeights, agent: agentSize }
    );
    const cards = layout.map((card): DerivedCard => {
        const content = cardContent(card);
        return {
            key: card.key,
            rect: card.rect,
            linkedFrom: card.kind === 'agent' ? card.from : 'node',
            label: content.label,
            content: content.body,
            lineDown: HEADER_MIDDLE,
            resize: card.kind === 'agent' ? { edges: AGENT_EDGES, minimum: AGENT_MIN, apply: resizeAgent } : undefined
        };
    });

    return <DerivedSet owner={id} z={z} cards={cards} lineDown={HEADER_MIDDLE} {...(accent === undefined ? {} : { stroke: accentShades(accent).line })} />;
}

/* The agent as the newest report has it, so its card follows the agent while the line it was picked from moves on. */
function workflowAgentView(workflow: ChatWorkflow, view: WorkflowAgentView, running: boolean): WorkflowAgentView {
    const agent = workflow.agents.find((candidate) => candidate.index === view.agent.index) ?? view.agent;
    return { agent, state: workflowAgentState(agent, running) };
}

function Summary({
    candidate,
    title,
    accent,
    stale,
    stopping,
    position,
    onSwitch,
    onStop,
    onDismiss,
    onShowInChat
}: {
    candidate: WorkflowCandidate;
    title: string;
    accent: string | undefined;
    stale: boolean;
    stopping: boolean;
    position: { index: number; count: number } | null;
    onSwitch: (step: number) => void;
    onStop: () => void;
    onDismiss: () => void;
    onShowInChat: () => void;
}) {
    const { t } = useTranslation('canvas');
    const { workflow, tool, running } = candidate;
    const counts = workflowCounts(workflowPhases(workflow, running));
    const ended = running ? null : workflowEndedAt(workflow);
    const time = ended === null ? null : formatElapsedShort(Math.max(0, ended - tool.createdAt));
    return (
        <div
            role="group"
            aria-label={title}
            className={clsx(FRAME, 'flex-row items-center gap-2 bg-surface-raised pr-1 pl-3 text-sm text-text')}
            style={accent === undefined ? undefined : { ...accentHeaderStyle(accent), borderColor: accentShades(accent).frameBorder }}
        >
            <Icon icon={Workflow} size={14} className={clsx('shrink-0', running ? 'text-accent' : 'text-text-muted')} />
            <span className="min-w-0 grow truncate font-medium">{title}</span>
            {running ? (
                <>
                    {workflow.stalledAt !== undefined && (
                        <Tooltip label={t('workflowBeside.stalled')}>
                            <span role="img" aria-label={t('workflowBeside.stalled')} className="flex shrink-0">
                                <Icon icon={TriangleAlert} size={14} className="text-status-needs-you" />
                            </span>
                        </Tooltip>
                    )}
                    {counts.total > 0 && (
                        <span className={TIME}>{t('workflowBeside.settled', { settled: counts.done + counts.failed, total: counts.total })}</span>
                    )}
                    <Elapsed startedAt={tool.createdAt} />
                </>
            ) : (
                <span role="status" className="shrink-0 truncate text-xs text-text-muted tabular-nums">
                    {t(tool.state === 'error' ? 'workflowBeside.failed' : 'workflowBeside.done', { time: time ?? '' })}
                    {counts.failed + counts.stopped > 0 && (
                        <span className="text-status-error"> · {t('workflowBeside.failedAgents', { count: counts.failed + counts.stopped })}</span>
                    )}
                </span>
            )}
            {stale && (
                <Tooltip label={t('workflowBeside.stale')}>
                    <span role="img" aria-label={t('workflowBeside.stale')} data-workflow-stale className="flex shrink-0">
                        <Icon icon={CloudOff} size={14} className="text-text-muted" />
                    </span>
                </Tooltip>
            )}
            <span className="flex shrink-0 items-center">
                {position !== null && (
                    <>
                        <IconButton icon={ChevronLeft} size="sm" label={t('workflowBeside.previous')} onClick={() => onSwitch(-1)} />
                        <span className={TIME}>{t('workflowBeside.switch', { index: position.index + 1, count: position.count })}</span>
                        <IconButton icon={ChevronRight} size="sm" label={t('workflowBeside.next')} onClick={() => onSwitch(1)} />
                    </>
                )}
                <IconButton icon={MessageSquareText} size="sm" label={t('workflowBeside.showInChat')} onClick={onShowInChat} />
                {running ? (
                    workflow.taskId !== undefined && (
                        <IconButton
                            icon={Square}
                            size="sm"
                            label={t(stopping ? 'workflowBeside.stopping' : 'workflowBeside.stop')}
                            disabled={stale || stopping}
                            onClick={onStop}
                        />
                    )
                ) : (
                    <IconButton icon={X} size="sm" label={t('workflowBeside.dismiss')} onClick={onDismiss} />
                )}
            </span>
        </div>
    );
}

function PhaseLine({ phase, title, accent, onOpen }: { phase: WorkflowPhaseView; title: string; accent: string | undefined; onOpen: () => void }) {
    const { t } = useTranslation('canvas');
    const { state, settled, total } = workflowPhaseState(phase);
    return (
        <CardLine icon={<PhaseDot state={state} />} accent={accent} label={t('workflowBeside.phase.open', { title })} onOpen={onOpen}>
            <span className="min-w-0 grow truncate">{title}</span>
            {total > 0 && <span className={TIME}>{t('workflowBeside.settled', { settled, total })}</span>}
            <PhaseTime phase={phase} />
        </CardLine>
    );
}

function OpenPhase({
    phase,
    title,
    accent,
    provider,
    refused,
    pickedIndex,
    onPick,
    onCollapse,
    onMeasure
}: {
    phase: WorkflowPhaseView;
    title: string;
    accent: string | undefined;
    provider: AgentKind | undefined;
    refused: boolean;
    /* The agent of this phase whose conversation is open beside it. */
    pickedIndex: number | undefined;
    onPick: (view: WorkflowAgentView, step: { toolUseId: string; description: string }) => void;
    onCollapse: () => void;
    /* The height the card would take to show all of its agents, which the layout keeps under its maximum. */
    onMeasure: (height: number) => void;
}) {
    const { t } = useTranslation('canvas');
    const { state, settled, total } = workflowPhaseState(phase);
    const listRef = useRef<HTMLDivElement>(null);
    const measured = useRef(onMeasure);
    useLayoutEffect(() => {
        measured.current = onMeasure;
    });
    // Before paint, so a phase that opens is drawn at its height and what stands under it moves once.
    useLayoutEffect(() => {
        const list = listRef.current;
        if (list === null) {
            return;
        }
        const measure = (): void => measured.current(CHROME_H + list.offsetHeight);
        const resizes = new ResizeObserver(measure);
        resizes.observe(list);
        measure();
        return () => resizes.disconnect();
    }, []);
    return (
        <div className={clsx(FRAME, 'bg-surface')} style={frameStyle(accent)}>
            <header className={clsx(HEADER, 'group/header')} style={accent === undefined ? undefined : accentHeaderStyle(accent)}>
                <KindIcon toggle={{ folded: false, label: t('workflowBeside.phase.collapse'), onToggle: onCollapse }}>
                    <span className="flex size-3.5 items-center justify-center">
                        <PhaseDot state={state} />
                    </span>
                </KindIcon>
                <span className="min-w-0 grow truncate font-medium">{title}</span>
                {total > 0 && <span className={TIME}>{t('workflowBeside.settled', { settled, total })}</span>}
                <span className="pr-2">
                    <PhaseTime phase={phase} />
                </span>
            </header>
            <div className="min-h-0 grow overflow-auto">
                <div ref={listRef} className="px-3 py-2">
                    {refused && <p className="pb-1 text-xs text-text-muted">{t('workflowBeside.unsupported')}</p>}
                    {phase.agents.map((view) => (
                        <WorkflowAgentLine
                            key={view.agent.index}
                            view={view}
                            provider={provider}
                            selected={pickedIndex === view.agent.index}
                            onOpen={refused ? undefined : (step) => onPick(view, step)}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function AgentCard({
    chatId,
    view,
    trail,
    accent,
    onBack,
    onOpenChild,
    onClose
}: {
    chatId: string;
    view: WorkflowAgentView;
    trail: readonly { toolUseId: string; description: string }[];
    accent: string | undefined;
    onBack: () => void;
    onOpenChild: (step: { toolUseId: string; description: string }) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation('canvas');
    const shown = trail.at(-1)!;
    const time = workflowAgentTime(view);
    return (
        <div className={clsx(FRAME, 'bg-surface')} style={frameStyle(accent)}>
            <header className={HEADER} style={accent === undefined ? undefined : accentHeaderStyle(accent)}>
                {trail.length > 1 && <IconButton icon={ArrowLeft} size="sm" label={t('workflowBeside.agentCard.back')} onClick={onBack} />}
                <span className="min-w-0 grow truncate font-medium">{trail.length > 1 ? shown.description : view.agent.label}</span>
                {view.state === 'running' && view.agent.startedAt !== null ? (
                    <Elapsed startedAt={view.agent.startedAt} />
                ) : (
                    time !== null && <span className={TIME}>{time}</span>
                )}
                <IconButton icon={X} size="sm" label={t('workflowBeside.agentCard.close')} onClick={onClose} />
            </header>
            <div className="flex min-h-0 grow flex-col [&_.chat-thread]:pb-4">
                <ErrorBoundary key={shown.toolUseId} label={t('chat.conversationFailed')} resetKeys={[shown.toolUseId]}>
                    <SubagentTimeline chatId={chatId} toolUseId={shown.toolUseId} info={false} onOpenConversation={onOpenChild} />
                </ErrorBoundary>
            </div>
        </div>
    );
}
