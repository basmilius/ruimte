import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Menu } from '@base-ui-components/react/menu';
import {
    Check,
    CheckCheck,
    ChevronDown,
    ChevronRight,
    Circle,
    CircleAlert,
    CircleCheck,
    CircleMinus,
    CircleX,
    Copy,
    FileText,
    Info,
    CirclePause,
    LoaderCircle,
    Lock,
    LockOpen,
    StickyNote,
    TriangleAlert,
    type LucideIcon
} from 'lucide-react';
import { PLAN_LIMITS, type Plan, type PlanStepState } from '@ruimte/contracts';
import { effectiveChecks, planProgress } from '@ruimte/plan';
import { Markdown } from '@/chat/ui/Markdown';
import { formatMoment } from '@/format/datetime';
import {
    collapsedOf,
    copyPlanMarkdown,
    notePlanStepAction,
    planViewKey,
    setPlanStepsAction,
    unlockPlanStepsAction,
    usePlanReveal,
    usePlanViewPrefs
} from '@/plan/plan-actions';
import { usePlanAgent } from '@/plan/plan-agent';
import {
    asksForNote,
    PERSON_STATES,
    planRows,
    progressParts,
    stateLabel,
    stepMarkdown,
    stepSetBy,
    TEST_OUTCOMES,
    toggledState,
    type PlanRow
} from '@/plan/plan-view';
import { chatWorking } from '@/state/agent-work';
import { useChatRow } from '@/state/chats';
import { MENU_LABEL, MENU_SEPARATOR, MULTILINE_FIELD } from '@/ui/classes';
import { copyText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';
import { TextMenu } from '@/ui/TextMenu';
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
    info: 'text-status-running'
};

// A row has one 20px column before its title (a parent's caret or a leaf's mark), so a level of
// sub-steps moves over by that column and its gap, and a child's mark stands under its parent's title.
const INDENT_PX = 24;
// With the row's `mx-1` it puts a step's column under the caret of the section above it.
const ROW_PADDING_PX = 8;
/* A group's row folds on a click anywhere, rounded and lit like a sidebar item. The outline stays off
   under the pointer, since `:focus-visible` alone stays on for a click after any keystroke. */
const TOGGLE_ROW = 'focus-ring cursor-default rounded-md hover:bg-surface-hover in-data-[modality=pointer]:focus-visible:outline-none';

// The length of `.plan-step-revealed` in `styles.css`, which also ends the mark with motion turned off.
const REVEAL_MS = 1600;

const whenText = (at: string): string => {
    const date = new Date(at);
    return Number.isNaN(date.getTime()) ? '' : formatMoment(date);
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
    const { t } = useTranslation('plan');
    const filter = usePlanViewPrefs((s) => s.filter);
    const collapseDone = usePlanViewPrefs((s) => s.collapseDone);
    const planKey = planViewKey(endpointId, chatId, plan.id);
    const collapsedIds = usePlanViewPrefs((s) => collapsedOf(s.collapsed, planKey));
    const working = useChatRow(chatId, (row) => chatWorking(row));
    const agent = usePlanAgent(chatId);
    const [editingNote, setEditingNote] = useState<string | null>(null);
    const target = usePlanReveal((s) => (s.target?.planKey === planKey ? s.target : null));
    const [revealed, setRevealed] = useState<{ id: string; nonce: number } | null>(null);
    const scroller = useRef<HTMLDivElement>(null);
    // A reveal asked for before this list mounted is not one to act on.
    const handled = useRef(target?.nonce ?? null);

    const rows = useMemo(() => planRows(plan, { filter, collapseDone, collapsed: new Set(collapsedIds) }), [plan, filter, collapseDone, collapsedIds]);
    const progress = planProgress(plan.items);

    // Rows as well. The folds and filter the reveal opened only draw in the render after it.
    useEffect(() => {
        if (target === null || handled.current === target.nonce) {
            return;
        }
        const row = scroller.current?.querySelector(`[data-plan-step="${CSS.escape(target.stepId)}"]`);
        if (!row) {
            return;
        }
        handled.current = target.nonce;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        row.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
        setRevealed({ id: target.stepId, nonce: target.nonce });
    }, [target, rows]);

    useEffect(() => {
        if (revealed === null) {
            return;
        }
        const timer = window.setTimeout(() => setRevealed(null), REVEAL_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [revealed]);

    const context: StepContext = {
        plan,
        agent,
        working,
        setState: (ids, state) => setPlanStepsAction(chatId, plan.id, ids, state),
        saveNote: (id, text) => notePlanStepAction(chatId, plan.id, id, text),
        unlock: (id) => unlockPlanStepsAction(chatId, plan.id, [id]),
        toggle: (id) => usePlanViewPrefs.getState().toggleCollapsed(planKey, id),
        editingNote,
        setEditingNote,
        revealed
    };

    return (
        <div className="flex min-h-0 grow flex-col">
            <PlanTextMenu plan={plan} className="flex shrink-0 flex-col gap-1.5 border-b border-border px-4 pt-3 pb-3">
                <div className="flex min-w-0 items-center gap-2 text-base font-medium text-text">
                    <Icon icon={CheckCheck} size={16} className="shrink-0 text-text-muted" />
                    <span className="min-w-0 truncate select-text">{plan.meta.title}</span>
                </div>
                {plan.meta.summary && <p className="text-xs whitespace-pre-wrap text-text-muted select-text">{plan.meta.summary}</p>}
                <div className="flex flex-wrap gap-x-3 text-xs text-text-muted tabular-nums">
                    <span>{t(`header.kind.${plan.meta.kind}`)}</span>
                    {progressParts(plan).map((part) => (
                        <span key={part}>{part}</span>
                    ))}
                </div>
                {plan.meta.status && <p className="text-xs text-text select-text">{plan.meta.status}</p>}
                <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                    <span className="bg-positive" style={{ flexGrow: progress.done }} />
                    <span className="bg-status-needs-you" style={{ flexGrow: progress.warning }} />
                    <span className="bg-status-running" style={{ flexGrow: progress.info }} />
                    <span className="bg-status-error" style={{ flexGrow: progress.failed }} />
                    <span className="bg-text-faint" style={{ flexGrow: progress.skipped + progress.blocked }} />
                    <span style={{ flexGrow: progress.open + progress.active }} />
                </div>
            </PlanTextMenu>
            <div ref={scroller} className="min-h-0 grow overflow-y-auto py-1">
                {rows.length === 0 && (
                    <p className="px-4 py-6 text-center text-xs text-text-muted">
                        {filter === 'issues' ? t('empty.issues') : filter === 'open' ? t('empty.open') : t('empty.all')}
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
    revealed: { id: string; nonce: number } | null;
}

/* The ring of the step an agent is on while its chat works; a pause once it stopped, so a still ring never reads as work. */
function ActiveRing({ working, agent, size }: { working: boolean; agent: string; size: number }) {
    const { t } = useTranslation('plan');
    if (working) {
        return <Icon icon={LoaderCircle} size={size} className="shrink-0 animate-spin text-accent" />;
    }
    return (
        <Tooltip label={t('agent.stoppedHere', { agent })}>
            <span className="inline-flex shrink-0 text-text-muted">
                <Icon icon={CirclePause} size={size} />
            </span>
        </Tooltip>
    );
}

function Caret({ collapsed }: { collapsed: boolean }) {
    return (
        <span className="grid h-5 w-5 shrink-0 place-items-center text-text-faint" aria-hidden>
            <Icon icon={collapsed ? ChevronRight : ChevronDown} size={14} />
        </span>
    );
}

/*
 * What makes the row of a section or parent step fold like a button. A click on a control inside
 * it (a note, a link, a tooltip's trigger) or one that ends a text selection is left alone.
 */
const toggleRowProps = (collapsed: boolean, onToggle: () => void) => ({
    role: 'button',
    tabIndex: 0,
    'aria-expanded': !collapsed,
    onClick: (event: ReactMouseEvent<HTMLElement>): void => {
        const control = event.target instanceof Element ? event.target.closest('a, button, input, textarea, [role="button"]') : null;
        if ((control !== null && control !== event.currentTarget) || window.getSelection()?.isCollapsed === false) {
            return;
        }
        onToggle();
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>): void => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onToggle();
        }
    }
});

function PlanRowView({ row, context }: { row: PlanRow; context: StepContext }) {
    if (row.type === 'section') {
        return (
            <PlanTextMenu plan={context.plan} className="pt-2">
                {/* The same box as a parent step's row, so a section and a step are equally tall and their carets line up. */}
                <div
                    className={clsx('mx-1 flex min-w-0 items-start gap-1 py-1 pr-2', TOGGLE_ROW)}
                    style={{ paddingLeft: ROW_PADDING_PX }}
                    {...toggleRowProps(row.collapsed, () => context.toggle(row.item.id))}
                >
                    <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center">
                        <Caret collapsed={row.collapsed} />
                    </span>
                    <span className="min-w-0 grow truncate text-sm font-medium text-text select-text">{row.item.title}</span>
                    <span className="mt-px flex h-5 shrink-0 items-center text-xs text-text-muted tabular-nums">
                        {row.progress.finished}/{row.progress.total}
                    </span>
                </div>
                {row.item.description && !row.collapsed && (
                    <div className="mx-1 pr-2 pl-8 text-text-muted select-text">
                        <Markdown text={row.item.description} fileLinks={false} />
                    </div>
                )}
            </PlanTextMenu>
        );
    }
    if (row.type === 'text') {
        return (
            <PlanTextMenu plan={context.plan} className="mx-4 my-2 border-l-2 border-border pl-3 select-text">
                <div className="text-sm font-medium wrap-anywhere text-text">{row.item.title}</div>
                {row.item.description && <Markdown text={row.item.description} fileLinks={false} />}
            </PlanTextMenu>
        );
    }
    return <StepRow row={row} context={context} />;
}

/* The text of a plan that is not a step, behind the same menu as any text, with the plan as a whole under it. */
function PlanTextMenu({ plan, className, children }: { plan: Plan; className: string; children: ReactNode }) {
    const { t } = useTranslation('plan');
    return (
        <TextMenu
            className={className}
            items={
                <ContextMenu.Item className="menu-item" onClick={() => copyPlanMarkdown(plan)}>
                    <Icon icon={FileText} size={14} /> {t('menu.copyPlan')}
                </ContextMenu.Item>
            }
        >
            {children}
        </TextMenu>
    );
}

function StepRow({ row, context }: { row: Extract<PlanRow, { type: 'step' }>; context: StepContext }) {
    const { t } = useTranslation(['plan', 'common']);
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
                data-plan-step={step.id}
                className={clsx(
                    'relative mx-1 flex min-w-0 items-start gap-1 rounded-md py-1 pr-2',
                    parent && TOGGLE_ROW,
                    row.state === 'active' && !parent && context.working && 'bg-accent-soft'
                )}
                style={{ paddingLeft: ROW_PADDING_PX + row.depth * INDENT_PX }}
                {...(parent ? toggleRowProps(row.collapsed, () => context.toggle(step.id)) : {})}
            >
                {/* Keyed on the click, so a second click on the same step starts the fade again. */}
                {context.revealed?.id === step.id && <span key={context.revealed.nonce} className="plan-step-revealed" aria-hidden />}
                {/* The glyph sits 1px lower than the line box centers it, where the eye puts the middle of the title's first line. */}
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center">
                    {parent ? <Caret collapsed={row.collapsed} /> : <StepMark row={row} context={context} locked={locked} setBy={setBy.tooltip} />}
                </span>
                <div className="min-w-0 grow">
                    <div className={clsx('text-sm wrap-anywhere select-text', finished ? 'text-text-muted' : 'text-text')}>{step.title}</div>
                    {stopped && <div className="text-xs text-text-muted">{t('agent.stoppedHere', { agent: context.agent })}</div>}
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
                                    row.state === 'failed' ? 'text-status-error' : row.state === 'warning' ? 'text-status-needs-you' : 'text-text-muted'
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
                                <div className={MENU_LABEL}>{t('step.menu.status')}</div>
                                {PERSON_STATES.map((state) => (
                                    <ContextMenu.Item
                                        key={state}
                                        className="menu-item"
                                        onClick={() => {
                                            context.setState([step.id], state);
                                            if (asksForNote(state)) {
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
                            <Icon icon={StickyNote} size={14} /> {step.note ? t('step.menu.editNote') : t('step.menu.addNote')}
                        </ContextMenu.Item>
                        {locked && (
                            <ContextMenu.Item className="menu-item" onClick={() => context.unlock(step.id)}>
                                <Icon icon={LockOpen} size={14} /> {t('step.menu.unlock')}
                            </ContextMenu.Item>
                        )}
                        <ContextMenu.Item className="menu-item" onClick={() => copyText(stepMarkdown(plan.meta.kind, step))}>
                            <Icon icon={Copy} size={14} /> {t('common:action.copy')}
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
    const { t } = useTranslation('plan');
    const { agent } = context;
    if (row.progress !== null) {
        return (
            <span className="mt-px flex h-5 shrink-0 items-center gap-1 text-xs text-text-muted tabular-nums">
                {row.activeBelow && <ActiveRing working={context.working} agent={agent} size={12} />}
                {row.progress.finished}/{row.progress.total}
            </span>
        );
    }
    if (setBy.text === null && !locked) {
        return null;
    }
    return (
        <span className="mt-px flex h-5 shrink-0 items-center gap-1 text-xs whitespace-nowrap text-text-faint">
            {setBy.text && <span>{setBy.text}</span>}
            {locked && (
                <Tooltip label={[t('step.lockedBy', { agent }), setBy.tooltip].filter(Boolean).join('. ')}>
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
    const { t } = useTranslation('plan');
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
        return stopped ? <Tooltip label={t('agent.stoppedHere', { agent: context.agent })}>{mark}</Tooltip> : mark;
    }
    if (plan.meta.kind === 'steps') {
        const next = toggledState(state);
        return (
            <Tooltip
                label={
                    stopped
                        ? t('agent.stoppedHere', { agent: context.agent })
                        : [setBy, t('step.markAs', { state: stateLabel('steps', next).toLowerCase() })].filter(Boolean).join('. ')
                }
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
            <Tooltip label={stopped ? t('agent.stoppedHere', { agent: context.agent }) : [label, setBy].filter(Boolean).join('. ')}>
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
                                    if (asksForNote(outcome)) {
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
    const { t } = useTranslation('plan');
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
            placeholder={t('note.placeholder')}
            aria-label={t('note.label')}
            className={clsx(MULTILINE_FIELD, 'mt-1 block select-text')}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => end(text.trim())}
        />
    );
}
