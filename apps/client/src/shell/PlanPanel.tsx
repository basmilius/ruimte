import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Menu } from '@base-ui-components/react/menu';
import { Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, Copy, LockOpen, MoreHorizontal, Send, X } from 'lucide-react';
import type { Plan } from '@ruimte/contracts';
import { allSteps, effectiveChecks } from '@ruimte/plan';
import { forkOriginIn } from '@/chat/logic/fork';
import { hasOverlayControls } from '@/desktop/bridge';
import { ActiveStepButton } from '@/plan/ActiveStepButton';
import { collapseAll, copyPlanMarkdown, expandAll, focusChat, planClient, planViewKey, sendResultsToChat, usePlanViewPrefs } from '@/plan/plan-actions';
import { closePlanPanel, pickPlan, PLAN_DEFAULT_WIDTH, PLAN_MIN_WIDTH } from '@/plan/plan-panel-watch';
import { PlanList } from '@/plan/PlanList';
import { resultsText, type PlanFilter } from '@/plan/plan-view';
import { clampColumnWidth, useColumnResize } from '@/shell/useColumnResize';
import { useInstantWidth } from '@/shell/useInstantWidth';
import { useDocument } from '@/state/document';
import { useEndpointId } from '@/state/keys';
import { useChatPlans } from '@/state/plans';
import { useUi } from '@/state/ui';
import { BTN_GROUP, MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

// The grid beside the panel keeps at least this much, the same floor the preview keeps.
const MIN_GRID_WIDTH = 360;
// The same number as `.panel-shell` in `styles.css`.
const TRANSITION_MS = 200;

const FILTERS: { id: PlanFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'open', label: 'Open' },
    { id: 'issues', label: 'Issues' }
];

const hasLockedStep = (plan: Plan): boolean => allSteps(plan.items).some((step) => effectiveChecks(plan, step) === 'agent');

/*
 * The plan of one chat, between the grid and the file preview. Built like the preview: a column of
 * width 0 and inert while closed, its contents mounted until the slide ends, its width dragged from
 * the left edge. Whether it is open is not its own business: `plan/panel-rules.ts` decides that from
 * what is on screen.
 */
export function PlanPanel() {
    const anchor = useUi((s) => s.planAnchor);
    const open = useUi((s) => s.planOpen);
    const rightOfIt = useUi((s) => s.preview.open || s.panel.open);
    const stored = useUi((s) => s.planWidth);
    const endpointId = useEndpointId();
    const plans = useChatPlans(anchor?.chatId ?? '');
    const found = plans.find((entry) => entry.id === anchor?.planId) ?? null;
    /* The plan it showed last, so a panel closing because its plan went away still has something to slide out with. */
    const [shown, setShown] = useState<{ chatId: string; plan: Plan } | null>(null);
    if (anchor !== null && found !== null && (shown?.plan !== found || shown.chatId !== anchor.chatId)) {
        setShown({ chatId: anchor.chatId, plan: found });
    }
    const [settled, setSettled] = useState(!open);
    const instant = useInstantWidth();
    if (instant && settled !== !open) {
        setSettled(!open);
    }
    const present = (open || !settled) && shown !== null;
    const ref = useRef<HTMLElement>(null);
    // The project may have been on a wider window than this one, so its width is clamped on the way in.
    const width = clampColumnWidth({ min: PLAN_MIN_WIDTH, max: () => window.innerWidth - MIN_GRID_WIDTH }, stored ?? PLAN_DEFAULT_WIDTH);
    const { startResize } = useColumnResize(ref, {
        min: PLAN_MIN_WIDTH,
        // Measured at drag time: the preview and the files panel beside it take their share of the window too.
        max: () => {
            const column = ref.current;
            const grid = column?.previousElementSibling;
            return grid instanceof HTMLElement && column ? grid.clientWidth + column.clientWidth - MIN_GRID_WIDTH : window.innerWidth - MIN_GRID_WIDTH;
        },
        width,
        from: 'right',
        onWidth: (next) => useUi.getState().setPlanWidth(next)
    });

    useEffect(() => {
        if (open || settled) {
            return;
        }
        // Reduced motion and a hidden tab paint no width change, so no `transitionend` arrives.
        const timer = window.setTimeout(() => setSettled(true), TRANSITION_MS + 50);
        return () => {
            window.clearTimeout(timer);
        };
    }, [open, settled]);

    return (
        <aside
            ref={ref}
            inert={!open}
            data-instant={instant ? '' : undefined}
            className="panel-shell flex h-full shrink-0 justify-end overflow-hidden"
            style={{ width: open ? width : 0 }}
            onTransitionEnd={(event) => {
                if (event.propertyName === 'width' && event.target === event.currentTarget) {
                    setSettled(!open);
                }
            }}
        >
            {present && (
                <div className="relative flex h-full shrink-0 flex-col border-l border-border bg-surface" style={{ width }}>
                    {open && <div className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize" onPointerDown={startResize} />}
                    <PlanHeader
                        endpointId={endpointId}
                        chatId={shown.chatId}
                        plans={plans}
                        plan={shown.plan}
                        inset={open && !rightOfIt && hasOverlayControls()}
                    />
                    {/* The header stays, so the panel can still be closed when a plan fails to draw. */}
                    <ErrorBoundary label="This plan failed to render" resetKeys={[shown.plan.id]} className="min-h-0 grow">
                        <PlanList key={shown.plan.id} endpointId={endpointId} chatId={shown.chatId} plan={shown.plan} />
                    </ErrorBoundary>
                </div>
            )}
        </aside>
    );
}

function PlanHeader({ endpointId, chatId, plans, plan, inset }: { endpointId: string; chatId: string; plans: readonly Plan[]; plan: Plan; inset: boolean }) {
    const title = useDocument((s) => forkOriginIn(s.views, chatId)?.title ?? null);
    const index = plans.findIndex((entry) => entry.id === plan.id);
    const results = resultsText(plan);
    const filter = usePlanViewPrefs((s) => s.filter);
    const collapseDone = usePlanViewPrefs((s) => s.collapseDone);
    const planKey = planViewKey(endpointId, chatId, plan.id);

    return (
        <header className={clsx('app-drag flex h-12 shrink-0 items-center gap-1 border-b border-border pr-2 pl-3', inset && 'toolbar-overlay-inset')}>
            <Tooltip label="Show this chat">
                <button
                    type="button"
                    className="min-w-0 truncate rounded-md px-1 py-0.5 text-xs font-medium text-text-muted hover:text-text"
                    onClick={() => focusChat(chatId)}
                >
                    {title ?? 'Chat'}
                </button>
            </Tooltip>
            {plans.length > 1 && index >= 0 && (
                <Menu.Root>
                    <Menu.Trigger className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-text-muted tabular-nums hover:bg-surface-hover hover:text-text data-[popup-open]:bg-surface-active">
                        Plan {plans.length - index} of {plans.length}
                        <Icon icon={ChevronDown} size={12} />
                    </Menu.Trigger>
                    <Menu.Portal>
                        <Menu.Positioner className="z-(--z-popup)" side="bottom" sideOffset={6} align="start">
                            <Menu.Popup className="menu-popup min-w-56">
                                {plans.map((entry) => (
                                    <Menu.Item key={entry.id} className="menu-item" onClick={() => pickPlan(entry.id)}>
                                        <span className="grid h-4 w-4 shrink-0 place-items-center">
                                            {entry.id === plan.id && <Icon icon={Check} size={14} />}
                                        </span>
                                        <span className="min-w-0 truncate">{entry.meta.title}</span>
                                    </Menu.Item>
                                ))}
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>
            )}
            <div className={clsx(BTN_GROUP, 'ml-auto shrink-0')}>
                <ActiveStepButton chatId={chatId} plan={plan} planKey={planKey} />
                <Menu.Root>
                    <Tooltip label="Plan actions" name>
                        <Menu.Trigger className="icon-btn">
                            <Icon icon={MoreHorizontal} size={16} />
                        </Menu.Trigger>
                    </Tooltip>
                    <Menu.Portal>
                        <Menu.Positioner className="z-(--z-popup)" side="bottom" sideOffset={6} align="end">
                            <Menu.Popup className="menu-popup min-w-56">
                                <div className={MENU_LABEL}>Show</div>
                                <Menu.RadioGroup value={filter} onValueChange={(value: PlanFilter) => usePlanViewPrefs.getState().setFilter(value)}>
                                    {FILTERS.map((entry) => (
                                        <Menu.RadioItem key={entry.id} value={entry.id} className="menu-item">
                                            <span className="grid h-4 w-4 place-items-center">
                                                <Menu.RadioItemIndicator>
                                                    <Icon icon={Check} size={14} />
                                                </Menu.RadioItemIndicator>
                                            </span>
                                            {entry.label}
                                        </Menu.RadioItem>
                                    ))}
                                </Menu.RadioGroup>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <Menu.CheckboxItem
                                    className="menu-item"
                                    checked={collapseDone}
                                    onCheckedChange={(checked) => usePlanViewPrefs.getState().setCollapseDone(checked)}
                                >
                                    <span className="grid h-4 w-4 place-items-center">
                                        <Menu.CheckboxItemIndicator>
                                            <Icon icon={Check} size={14} />
                                        </Menu.CheckboxItemIndicator>
                                    </span>
                                    Collapse done
                                </Menu.CheckboxItem>
                                <Menu.Item className="menu-item" onClick={() => expandAll(planKey)}>
                                    <Icon icon={ChevronsUpDown} size={14} /> Expand all
                                </Menu.Item>
                                <Menu.Item className="menu-item" onClick={() => collapseAll(planKey, plan)}>
                                    <Icon icon={ChevronsDownUp} size={14} /> Collapse all
                                </Menu.Item>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <Menu.Item className="menu-item" onClick={() => copyPlanMarkdown(plan)}>
                                    <Icon icon={Copy} size={14} /> Copy as Markdown
                                </Menu.Item>
                                <Menu.Item className="menu-item" disabled={results === null} onClick={() => sendResultsToChat(chatId, plan)}>
                                    <Icon icon={Send} size={14} /> Send results to chat
                                </Menu.Item>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <Menu.Item
                                    className="menu-item"
                                    disabled={!hasLockedStep(plan)}
                                    onClick={() => void planClient.unlock(endpointId, chatId, plan.id, 'all')}
                                >
                                    <Icon icon={LockOpen} size={14} /> Unlock all
                                </Menu.Item>
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>
                <Tooltip label="Close the plan" name>
                    <button type="button" className="icon-btn" onClick={closePlanPanel}>
                        <Icon icon={X} size={16} />
                    </button>
                </Tooltip>
            </div>
        </header>
    );
}
