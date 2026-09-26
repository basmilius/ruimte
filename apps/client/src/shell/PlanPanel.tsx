import { useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Copy, LockOpen, MoreHorizontal, Send } from 'lucide-react';
import type { Plan } from '@ruimte/contracts';
import { allSteps, effectiveChecks } from '@ruimte/plan';
import { forkOriginIn } from '@/chat/fork-origin';
import { hasOverlayControls } from '@/desktop/bridge';
import { ActiveStepButton } from '@/plan/ActiveStepButton';
import {
    collapseAll,
    copyPlanMarkdown,
    expandAll,
    focusChat,
    planViewKey,
    sendResultsToChat,
    unlockPlanStepsAction,
    usePlanViewPrefs
} from '@/plan/plan-actions';
import { closePlanPanel, pickPlan, PLAN_DEFAULT_WIDTH, PLAN_MIN_WIDTH } from '@/plan/plan-panel-watch';
import { PlanList } from '@/plan/PlanList';
import { resultsText, type PlanFilter } from '@/plan/plan-view';
import { SlidingColumn } from '@/shell/SlidingColumn';
import { clampColumnSize } from '@/shell/useColumnResize';
import { useDocument } from '@/state/document';
import { useEndpointId } from '@/state/keys';
import { useChatPlans } from '@/state/plans';
import { useUi } from '@/state/ui';
import { BTN_GROUP, MENU_LABEL, MENU_SEPARATOR, PANEL_HEADER, SECTION_LABEL } from '@ruimte/ui/classes';
import { ErrorBoundary } from '@ruimte/ui/ErrorBoundary';
import { CloseButton } from '@ruimte/ui/CloseButton';
import { Icon } from '@ruimte/ui/Icon';
import { MenuCheck } from '@ruimte/ui/MenuCheck';
import { Tooltip } from '@ruimte/ui/Tooltip';
import { MenuPopup } from '@ruimte/ui/MenuPopup';

// The grid beside the panel keeps at least this much, whatever the drag asks for.
const MIN_GRID_WIDTH = 360;

/* Only the ids; the words a person reads are `planPanel.filters.<id>`, read inside the menu. */
const FILTERS: readonly PlanFilter[] = ['all', 'open', 'issues'];

const hasLockedStep = (plan: Plan): boolean => allSteps(plan.items).some((step) => effectiveChecks(plan, step) === 'agent');

/*
 * The plan of one chat, between the grid and the panels. A column of width 0 and inert while
 * closed, its contents mounted until the slide ends, its width dragged from the left edge. Whether it is open is not its own business: `plan/panel-rules.ts` decides that from
 * what is on screen.
 */
export function PlanPanel() {
    const { t } = useTranslation('shell');
    const anchor = useUi((s) => s.planAnchor);
    const open = useUi((s) => s.planOpen);
    const rightOfIt = useUi((s) => s.panel.open);
    const stored = useUi((s) => s.planWidth);
    const endpointId = useEndpointId();
    const plans = useChatPlans(anchor?.chatId ?? '');
    const found = plans.find((entry) => entry.id === anchor?.planId) ?? null;
    /* The plan it showed last, so a panel closing because its plan went away still has something to slide out with. */
    const [shown, setShown] = useState<{ chatId: string; plan: Plan } | null>(null);
    if (anchor !== null && found !== null && (shown?.plan !== found || shown.chatId !== anchor.chatId)) {
        setShown({ chatId: anchor.chatId, plan: found });
    }
    const ref = useRef<HTMLElement>(null);
    const bounds = {
        min: PLAN_MIN_WIDTH,
        // Measured at drag time: the files panel beside it takes its share of the window too.
        max: (): number => {
            const column = ref.current;
            const grid = column?.previousElementSibling;
            return grid instanceof HTMLElement && column ? grid.clientWidth + column.clientWidth - MIN_GRID_WIDTH : window.innerWidth - MIN_GRID_WIDTH;
        }
    };
    // The project may have been on a wider window than this one, so its width is clamped on the way in.
    const width = clampColumnSize({ min: PLAN_MIN_WIDTH, max: () => window.innerWidth - MIN_GRID_WIDTH }, stored ?? PLAN_DEFAULT_WIDTH);

    return (
        <SlidingColumn open={open} width={width} bounds={bounds} columnRef={ref} onWidth={(next) => useUi.getState().setPlanWidth(next)}>
            {shown !== null && (
                <>
                    <PlanHeader
                        endpointId={endpointId}
                        chatId={shown.chatId}
                        plans={plans}
                        plan={shown.plan}
                        inset={open && !rightOfIt && hasOverlayControls()}
                    />
                    {/* The header stays, so the panel can still be closed when a plan fails to draw. */}
                    <ErrorBoundary label={t('planPanel.failed')} resetKeys={[shown.plan.id]} className="min-h-0 grow">
                        <PlanList key={shown.plan.id} endpointId={endpointId} chatId={shown.chatId} plan={shown.plan} />
                    </ErrorBoundary>
                </>
            )}
        </SlidingColumn>
    );
}

function PlanHeader({ endpointId, chatId, plans, plan, inset }: { endpointId: string; chatId: string; plans: readonly Plan[]; plan: Plan; inset: boolean }) {
    const { t } = useTranslation('shell');
    const title = useDocument((s) => forkOriginIn(s.views, chatId)?.title ?? null);
    const index = plans.findIndex((entry) => entry.id === plan.id);
    const results = resultsText(plan);
    const filter = usePlanViewPrefs((s) => s.filter);
    const collapseDone = usePlanViewPrefs((s) => s.collapseDone);
    const planKey = planViewKey(endpointId, chatId, plan.id);

    return (
        <header className={clsx(PANEL_HEADER, 'app-drag', inset && 'toolbar-overlay-inset')}>
            <Tooltip label={t('planPanel.showChat')}>
                <button type="button" className={`${SECTION_LABEL} min-w-0 truncate rounded-md hover:text-text`} onClick={() => focusChat(chatId)}>
                    {title ?? t('planPanel.chat')}
                </button>
            </Tooltip>
            {plans.length > 1 && index >= 0 && (
                <Menu.Root>
                    <Menu.Trigger className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-text-muted tabular-nums hover:bg-surface-hover hover:text-text data-[popup-open]:bg-surface-active">
                        {t('planPanel.planOf', { number: plans.length - index, total: plans.length })}
                        <Icon icon={ChevronDown} size={12} />
                    </Menu.Trigger>
                    <MenuPopup className="min-w-56">
                        {plans.map((entry) => (
                            <Menu.Item key={entry.id} className="menu-item" onClick={() => pickPlan(entry.id)}>
                                <MenuCheck kind="radio" checked={entry.id === plan.id} />
                                <span className="min-w-0 truncate">{entry.meta.title}</span>
                            </Menu.Item>
                        ))}
                    </MenuPopup>
                </Menu.Root>
            )}
            <div className={clsx(BTN_GROUP, 'ml-auto shrink-0')}>
                <ActiveStepButton chatId={chatId} plan={plan} planKey={planKey} />
                <Menu.Root>
                    <Tooltip label={t('planPanel.actions')} name>
                        <Menu.Trigger className="icon-btn">
                            <Icon icon={MoreHorizontal} size={16} />
                        </Menu.Trigger>
                    </Tooltip>
                    <MenuPopup align="end" className="min-w-56">
                        <div className={MENU_LABEL}>{t('planPanel.show')}</div>
                        <Menu.RadioGroup value={filter} onValueChange={(value: PlanFilter) => usePlanViewPrefs.getState().setFilter(value)}>
                            {FILTERS.map((id) => (
                                <Menu.RadioItem key={id} value={id} className="menu-item">
                                    <MenuCheck kind="radio" />
                                    {t(`planPanel.filters.${id}`)}
                                </Menu.RadioItem>
                            ))}
                        </Menu.RadioGroup>
                        <Menu.Separator className={MENU_SEPARATOR} />
                        <Menu.CheckboxItem
                            className="menu-item"
                            checked={collapseDone}
                            onCheckedChange={(checked) => usePlanViewPrefs.getState().setCollapseDone(checked)}
                        >
                            <MenuCheck kind="checkbox" />
                            {t('planPanel.collapseDone')}
                        </Menu.CheckboxItem>
                        <Menu.Item className="menu-item" onClick={() => expandAll(planKey)}>
                            <Icon icon={ChevronsUpDown} size={14} /> {t('planPanel.expandAll')}
                        </Menu.Item>
                        <Menu.Item className="menu-item" onClick={() => collapseAll(planKey, plan)}>
                            <Icon icon={ChevronsDownUp} size={14} /> {t('planPanel.collapseAll')}
                        </Menu.Item>
                        <Menu.Separator className={MENU_SEPARATOR} />
                        <Menu.Item className="menu-item" onClick={() => copyPlanMarkdown(plan)}>
                            <Icon icon={Copy} size={14} /> {t('planPanel.copyMarkdown')}
                        </Menu.Item>
                        <Menu.Item className="menu-item" disabled={results === null} onClick={() => sendResultsToChat(chatId, plan)}>
                            <Icon icon={Send} size={14} /> {t('planPanel.sendResults')}
                        </Menu.Item>
                        <Menu.Separator className={MENU_SEPARATOR} />
                        <Menu.Item className="menu-item" disabled={!hasLockedStep(plan)} onClick={() => unlockPlanStepsAction(chatId, plan.id, null)}>
                            <Icon icon={LockOpen} size={14} /> {t('planPanel.unlockAll')}
                        </Menu.Item>
                    </MenuPopup>
                </Menu.Root>
                <CloseButton label={t('planPanel.close')} onClick={closePlanPanel} />
            </div>
        </header>
    );
}
