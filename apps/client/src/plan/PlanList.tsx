import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import clsx from 'clsx';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Menu } from '@base-ui-components/react/menu';
import {
    Check,
    ChevronDown,
    ChevronRight,
    ChevronsDownUp,
    Circle,
    CircleAlert,
    CircleCheck,
    CircleMinus,
    CircleX,
    Copy,
    Info,
    ListChecks,
    CirclePause,
    LoaderCircle,
    Lock,
    LockOpen,
    StickyNote,
    TriangleAlert,
    type LucideIcon
} from 'lucide-react';
import { PLAN_LIMITS, type Plan, type PlanStepState } from '@ruimte/contracts';
import { effectiveChecks, planProgress, progressText } from '@ruimte/plan';
import { Markdown } from '@/chat/ui/Markdown';
import { collapsedOf, planClient, usePlanViewPrefs } from '@/plan/plan-actions';
import {
    activeStep,
    agentName,
    PERSON_STATES,
    planRows,
    stateLabel,
    stepMarkdown,
    stepSetBy,
    TEST_OUTCOMES,
    toggledState,
    type PlanFilter,
    type PlanRow
} from '@/plan/plan-view';
import { chatWorking } from '@/state/agent-work';
import { useChatRow } from '@/state/chats';
import { useDocument } from '@/state/document';
import { endpointKey } from '@/state/keys';
import { MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { copyText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const STATE_ICON: Record<PlanStepState, LucideIcon> = {
    open: Circle,
    active: LoaderCircle,
    done: CircleCheck,
    failed: CircleX,
    skipped: CircleMinus,
    blocked: CircleAlert,
    warning: TriangleAlert,
    info: Info
};

const STATE_TONE: Record<PlanStepState, string> = {
    open: 'text-text-faint',
    active: 'text-accent',
    done: 'text-positive',
    failed: 'text-status-error',
    skipped: 'text-text-faint',
    blocked: 'text-status-needs-you',
    warning: 'text-status-needs-you',
    info: 'text-accent'
};

const FILTERS: { id: PlanFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'open', label: 'Open' },
    { id: 'failed', label: 'Failed' }
];

// Each level of sub-steps moves over by the width of the fold arrow and the mark together.
const INDENT_PX = 20;
const ROW_PADDING_PX = 12;

const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const DAY_AND_TIME = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const whenText = (at: string): string => {
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return date.toDateString() === new Date().toDateString() ? TIME.format(date) : DAY_AND_TIME.format(date);
};

/* The provider of a chat as the project names it, for a chat this client has not attached yet. */
const providerIn = (views: ReturnType<typeof useDocument.getState>['views'], chatId: string): string | null => {
    for (const view of views) {
        if (view.kind === 'chat' && view.id === chatId) {
            return view.node.provider ?? null;
        }
        if (view.kind === 'canvas') {
            const node = view.nodes.find((candidate) => candidate.id === chatId);
            if (node) {
                return node.provider ?? null;
            }
        }
    }
    return null;
};

interface PlanListProps {
    endpointId: string;
    chatId: string;
    plan: Plan;
}

/*
 * One plan: its header with the progress and the filter, then every section, text block and step. A
 * person checks steps off, writes a note and lifts a lock here; the structure is the agent's, so
 * nothing here adds, edits, moves or removes an item.
 */
export function PlanList({ endpointId, chatId, plan }: PlanListProps) {
    const filter = usePlanViewPrefs((s) => s.filter);
    const collapseDone = usePlanViewPrefs((s) => s.collapseDone);
    const planKey = `${endpointKey(endpointId, chatId)}:${plan.id}`;
    const collapsedIds = usePlanViewPrefs((s) => collapsedOf(s.collapsed, planKey));
    const working = useChatRow(chatId, (row) => chatWorking(row));
    const liveProvider = useChatRow(chatId, (row) => row?.info.provider ?? null);
    const documentProvider = useDocument((s) => providerIn(s.views, chatId));
    const agent = agentName(liveProvider ?? documentProvider);
    const [editingNote, setEditingNote] = useState<string | null>(null);

    const rows = useMemo(() => planRows(plan, { filter, collapseDone, collapsed: new Set(collapsedIds) }), [plan, filter, collapseDone, collapsedIds]);
    const progress = planProgress(plan.items);
    const now = activeStep(plan);
    const context: StepContext = {
        plan,
        agent,
        working,
        setState: (ids, state) => void planClient.setState(endpointId, chatId, plan.id, ids, state),
        saveNote: (id, text) => void planClient.note(endpointId, chatId, plan.id, id, text),
        unlock: (id) => void planClient.unlock(endpointId, chatId, plan.id, [id]),
        toggle: (id) => usePlanViewPrefs.getState().toggleCollapsed(planKey, id),
        editingNote,
        setEditingNote
    };

    return (
        <div className="flex min-h-0 grow flex-col">
            <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-4 pt-3 pb-3">
                <div className="flex min-w-0 items-center gap-2 text-base font-medium text-text">
                    <Icon icon={ListChecks} size={16} className="shrink-0 text-text-muted" />
                    <span className="min-w-0 truncate select-text">{plan.meta.title}</span>
                </div>
                {plan.meta.summary && <p className="text-xs whitespace-pre-wrap text-text-muted select-text">{plan.meta.summary}</p>}
                <div className="flex flex-wrap gap-x-3 text-xs text-text-muted tabular-nums">
                    <span>{plan.meta.kind === 'test' ? 'Test plan' : 'Steps'}</span>
                    {progressText(plan)
                        .split(', ')
                        .map((part) => (
                            <span key={part}>{part}</span>
                        ))}
                </div>
                {plan.meta.status && <p className="text-xs text-text select-text">{plan.meta.status}</p>}
                {now && (
                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
                        <ActiveRing working={working} agent={agent} size={12} />
                        <span className="min-w-0 truncate">{now.title}</span>
                    </div>
                )}
                <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                    <span className="bg-positive" style={{ flexGrow: progress.done }} />
                    <span className="bg-status-error" style={{ flexGrow: progress.failed }} />
                    <span className="bg-text-faint" style={{ flexGrow: progress.skipped + progress.blocked }} />
                    <span style={{ flexGrow: progress.open + progress.active }} />
                </div>
                <div className="mt-1 flex items-center gap-2">
                    <div className="inline-flex items-center gap-px rounded-lg bg-surface-sunken p-0.5" role="radiogroup" aria-label="Show steps">
                        {FILTERS.map((entry) => (
                            <button
                                key={entry.id}
                                type="button"
                                role="radio"
                                aria-checked={filter === entry.id}
                                className={clsx(
                                    'rounded-md px-2 text-xs',
                                    filter === entry.id ? 'bg-surface text-text shadow-node' : 'text-text-muted hover:text-text'
                                )}
                                onClick={() => usePlanViewPrefs.getState().setFilter(entry.id)}
                            >
                                {entry.label}
                            </button>
                        ))}
                    </div>
                    <Tooltip label="Collapse done" name>
                        <button
                            type="button"
                            className="icon-btn ml-auto h-7 w-7"
                            aria-pressed={collapseDone}
                            data-active={collapseDone || undefined}
                            onClick={() => usePlanViewPrefs.getState().setCollapseDone(!collapseDone)}
                        >
                            <Icon icon={ChevronsDownUp} size={14} />
                        </button>
                    </Tooltip>
                </div>
            </div>
            <div className="min-h-0 grow overflow-y-auto py-1">
                {rows.length === 0 && (
                    <p className="px-4 py-6 text-center text-xs text-text-muted">
                        {filter === 'failed' ? 'Nothing failed.' : filter === 'open' ? 'Nothing is open.' : 'This plan has no steps yet.'}
                    </p>
                )}
                {rows.map((row) => (
                    <PlanRowView key={row.item.id} row={row} context={context} />
                ))}
            </div>
        </div>
    );
}

interface StepContext {
    plan: Plan;
    agent: string;
    working: boolean;
    setState(ids: string[], state: PlanStepState): void;
    saveNote(id: string, text: string): void;
    unlock(id: string): void;
    toggle(id: string): void;
    editingNote: string | null;
    setEditingNote(id: string | null): void;
}

/* The ring of the step an agent is on while its chat works; a pause once it stopped, so a still ring never reads as work. */
function ActiveRing({ working, agent, size }: { working: boolean; agent: string; size: number }) {
    if (working) {
        return <Icon icon={LoaderCircle} size={size} className="shrink-0 animate-spin text-accent" />;
    }
    return (
        <Tooltip label={`${agent} stopped here`}>
            <span className="inline-flex shrink-0 text-text-muted">
                <Icon icon={CirclePause} size={size} />
            </span>
        </Tooltip>
    );
}

function Caret({ collapsed, onToggle, label }: { collapsed: boolean; onToggle: () => void; label: string }) {
    return (
        <button
            type="button"
            aria-label={label}
            aria-expanded={!collapsed}
            className="grid h-5 w-4 shrink-0 place-items-center text-text-faint hover:text-text"
            onClick={onToggle}
        >
            <Icon icon={collapsed ? ChevronRight : ChevronDown} size={14} />
        </button>
    );
}

function PlanRowView({ row, context }: { row: PlanRow; context: StepContext }) {
    if (row.type === 'section') {
        return (
            <div className="px-3 pt-3 pb-1">
                <div className="flex min-w-0 items-center gap-1">
                    <Caret collapsed={row.collapsed} onToggle={() => context.toggle(row.item.id)} label={row.collapsed ? 'Expand' : 'Collapse'} />
                    <span className="min-w-0 grow truncate text-sm font-medium text-text select-text">{row.item.title}</span>
                    <span className="shrink-0 text-xs text-text-muted tabular-nums">
                        {row.progress.finished}/{row.progress.total}
                    </span>
                </div>
                {row.item.description && !row.collapsed && (
                    <div className="pl-5 text-text-muted select-text">
                        <Markdown text={row.item.description} fileLinks={false} />
                    </div>
                )}
            </div>
        );
    }
    if (row.type === 'text') {
        return (
            <div className="mx-4 my-2 border-l-2 border-border pl-3 select-text">
                <div className="text-sm font-medium wrap-anywhere text-text">{row.item.title}</div>
                {row.item.description && <Markdown text={row.item.description} fileLinks={false} />}
            </div>
        );
    }
    return <StepRow row={row} context={context} />;
}

function StepRow({ row, context }: { row: Extract<PlanRow, { type: 'step' }>; context: StepContext }) {
    const { plan } = context;
    const step = row.item;
    const parent = row.progress !== null;
    const locked = effectiveChecks(plan, step) === 'agent';
    const finished = row.state === 'done' || row.state === 'skipped';
    const stopped = row.state === 'active' && !parent && !context.working;
    const editing = context.editingNote === step.id;
    const setBy = stepSetBy(step, row.state, context.agent, step.at ? whenText(step.at) : '');

    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<div />}
                className={clsx('flex min-w-0 items-start gap-1 py-1 pr-3', row.state === 'active' && !parent && context.working && 'bg-accent-soft')}
                style={{ paddingLeft: ROW_PADDING_PX + row.depth * INDENT_PX }}
            >
                <span className="flex h-5 w-4 shrink-0 items-center justify-center">
                    {parent && <Caret collapsed={row.collapsed} onToggle={() => context.toggle(step.id)} label={row.collapsed ? 'Expand' : 'Collapse'} />}
                </span>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                    <StepMark row={row} context={context} locked={locked} setBy={setBy.tooltip} />
                </span>
                <div className="min-w-0 grow">
                    <div className={clsx('text-sm wrap-anywhere select-text', finished ? 'text-text-muted' : 'text-text')}>{step.title}</div>
                    {stopped && <div className="text-xs text-text-muted">{context.agent} stopped here</div>}
                    {step.description && (
                        <div className="text-text-muted select-text">
                            <Markdown text={step.description} fileLinks={false} />
                        </div>
                    )}
                    {editing ? (
                        <NoteEditor
                            initial={step.note ?? ''}
                            onDone={(text) => {
                                context.setEditingNote(null);
                                if (text !== null && text !== (step.note ?? '')) {
                                    context.saveNote(step.id, text);
                                }
                            }}
                        />
                    ) : (
                        step.note && (
                            <button
                                type="button"
                                className={clsx(
                                    'block w-full text-left text-xs whitespace-pre-wrap wrap-anywhere select-text',
                                    row.state === 'failed' ? 'text-status-error' : 'text-text-muted'
                                )}
                                onClick={() => context.setEditingNote(step.id)}
                            >
                                {step.note}
                            </button>
                        )
                    )}
                </div>
                <StepAside row={row} context={context} locked={locked} setBy={setBy} />
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
                <ContextMenu.Positioner className="z-(--z-popup)">
                    <ContextMenu.Popup className="menu-popup min-w-48">
                        {!parent && !locked && (
                            <>
                                <div className={MENU_LABEL}>Status</div>
                                {PERSON_STATES.map((state) => (
                                    <ContextMenu.Item
                                        key={state}
                                        className="menu-item"
                                        onClick={() => {
                                            context.setState([step.id], state);
                                            if (state === 'failed') {
                                                context.setEditingNote(step.id);
                                            }
                                        }}
                                    >
                                        <Icon icon={STATE_ICON[state]} size={14} className={STATE_TONE[state]} />
                                        {stateLabel(plan.meta.kind, state)}
                                        {row.state === state && <Icon icon={Check} size={14} className="ml-auto" />}
                                    </ContextMenu.Item>
                                ))}
                                <ContextMenu.Separator className={MENU_SEPARATOR} />
                            </>
                        )}
                        <ContextMenu.Item className="menu-item" onClick={() => context.setEditingNote(step.id)}>
                            <Icon icon={StickyNote} size={14} /> {step.note ? 'Edit note' : 'Add note'}
                        </ContextMenu.Item>
                        {locked && (
                            <ContextMenu.Item className="menu-item" onClick={() => context.unlock(step.id)}>
                                <Icon icon={LockOpen} size={14} /> Unlock
                            </ContextMenu.Item>
                        )}
                        <ContextMenu.Item className="menu-item" onClick={() => copyText(stepMarkdown(plan.meta.kind, step))}>
                            <Icon icon={Copy} size={14} /> Copy
                        </ContextMenu.Item>
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
}

/* What stands at the end of a step's row: the count of a parent, when a person set a step, and the lock of one only the agent sets. */
function StepAside({
    row,
    context,
    locked,
    setBy
}: {
    row: Extract<PlanRow, { type: 'step' }>;
    context: StepContext;
    locked: boolean;
    setBy: ReturnType<typeof stepSetBy>;
}) {
    const { agent } = context;
    if (row.progress !== null) {
        return (
            <span className="flex h-5 shrink-0 items-center gap-1 text-xs text-text-muted tabular-nums">
                {row.activeBelow && <ActiveRing working={context.working} agent={agent} size={12} />}
                {row.progress.finished}/{row.progress.total}
            </span>
        );
    }
    if (setBy.text === null && !locked) {
        return null;
    }
    return (
        <span className="flex h-5 shrink-0 items-center gap-1 text-xs whitespace-nowrap text-text-faint">
            {setBy.text && <span>{setBy.text}</span>}
            {locked && (
                <Tooltip label={[`Only ${agent} checks this step`, setBy.tooltip].filter(Boolean).join('. ')}>
                    <span className="inline-flex">
                        <Icon icon={Lock} size={12} />
                    </span>
                </Tooltip>
            )}
        </span>
    );
}

/* `setBy` goes in the mark's tooltip only while nothing else in the row carries it; a locked step says it on its lock. */
function StepMark({ row, context, locked, setBy }: { row: Extract<PlanRow, { type: 'step' }>; context: StepContext; locked: boolean; setBy: string | null }) {
    const { plan } = context;
    const state = row.state;
    // A parent has no state of its own to set; its count at the end of the row says how far it is.
    if (row.progress !== null) {
        return null;
    }
    const label = stateLabel(plan.meta.kind, state);
    const stopped = state === 'active' && !context.working;
    const glyph = stopped ? (
        <Icon icon={CirclePause} size={16} className="text-text-muted" />
    ) : (
        <Icon icon={STATE_ICON[state]} size={16} className={clsx(STATE_TONE[state], state === 'active' && 'animate-spin')} />
    );
    if (locked) {
        const mark = (
            <span className="inline-flex" role="img" aria-label={label}>
                {glyph}
            </span>
        );
        return stopped ? <Tooltip label={`${context.agent} stopped here`}>{mark}</Tooltip> : mark;
    }
    if (plan.meta.kind === 'steps') {
        const next = toggledState(state);
        return (
            <Tooltip
                label={stopped ? `${context.agent} stopped here` : [setBy, `Mark as ${stateLabel('steps', next).toLowerCase()}`].filter(Boolean).join('. ')}
            >
                <button
                    type="button"
                    aria-label={label}
                    className="grid h-5 w-5 place-items-center rounded-full hover:bg-surface-hover"
                    onClick={() => context.setState([row.item.id], next)}
                >
                    {glyph}
                </button>
            </Tooltip>
        );
    }
    return (
        <Menu.Root>
            <Tooltip label={stopped ? `${context.agent} stopped here` : [label, setBy].filter(Boolean).join('. ')}>
                <Menu.Trigger
                    aria-label={label}
                    className="grid h-5 w-5 place-items-center rounded-full hover:bg-surface-hover data-[popup-open]:bg-surface-active"
                >
                    {glyph}
                </Menu.Trigger>
            </Tooltip>
            <Menu.Portal>
                <Menu.Positioner className="z-(--z-popup)" side="bottom" sideOffset={4} align="start">
                    <Menu.Popup className="menu-popup min-w-40">
                        {TEST_OUTCOMES.map((outcome) => (
                            <Menu.Item
                                key={outcome}
                                className="menu-item"
                                onClick={() => {
                                    context.setState([row.item.id], outcome);
                                    if (outcome === 'failed') {
                                        context.setEditingNote(row.item.id);
                                    }
                                }}
                            >
                                <Icon icon={STATE_ICON[outcome]} size={14} className={STATE_TONE[outcome]} />
                                {stateLabel('test', outcome)}
                                {state === outcome && <Icon icon={Check} size={14} className="ml-auto" />}
                            </Menu.Item>
                        ))}
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}

/* The note under a step, written in place. Enter keeps it, Escape leaves it as it was. */
function NoteEditor({ initial, onDone }: { initial: string; onDone: (text: string | null) => void }) {
    const [text, setText] = useState(initial);
    // Enter and Escape end the edit, and the blur that follows must not end it a second time.
    const ended = useRef(false);
    const end = (result: string | null): void => {
        if (!ended.current) {
            ended.current = true;
            onDone(result);
        }
    };
    const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            end(text.trim());
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            end(null);
        }
    };
    return (
        <textarea
            // A note field that just opened is where the person is about to type, from a Failed as much as from the menu.
            autoFocus
            rows={2}
            maxLength={PLAN_LIMITS.note}
            value={text}
            placeholder="What happened?"
            aria-label="Note"
            className="mt-1 block w-full resize-none rounded-md border border-border bg-surface-sunken px-2 py-1 text-xs text-text outline-none select-text focus:border-accent"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => end(text.trim())}
        />
    );
}
