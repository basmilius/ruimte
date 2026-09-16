import { PlanPanelRules, type PlanClock, type PlanPanelIo } from '@/plan/panel-rules';
import { chatsInSight, liveChatSight } from '@/state/attention';
import { subscribeCanvases } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { findPlan, subscribePlanCreated, usePlans } from '@/state/plans';
import { useUi } from '@/state/ui';
import { subscribeCurrentWorkspace } from '@/state/workspace-stores';

export const PLAN_MIN_WIDTH = 320;
export const PLAN_DEFAULT_WIDTH = 360;

const windowClock: PlanClock = {
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number)
};

let rules: PlanPanelRules | null = null;

const uiIo = (clock: PlanClock): PlanPanelIo => ({
    get: () => ({ anchor: useUi.getState().planAnchor, open: useUi.getState().planOpen }),
    set: (state) => useUi.getState().setPlanPanel(state),
    clock
});

/* Rules that exist before the watch starts, for a press in a test or before boot; they see no chat in sight. */
const activeRules = (): PlanPanelRules => (rules ??= new PlanPanelRules(uiIo(windowClock)));

/* A press on a chat's pill: that plan in the panel, open, whatever was closed before. */
export const openPlanFromPill = (chatId: string, planId: string): void => {
    usePlans.getState().markSeen(currentEndpointId(), chatId);
    activeRules().pill(chatId, planId);
};

export const closePlanPanel = (): void => activeRules().close();

export const pickPlan = (planId: string): void => activeRules().pick(planId);

/*
 * Keeps the plan panel in line with what is on screen: which chats are in sight, which plans exist
 * and which were just made. The measuring runs once a frame at most, since a pan changes a canvas on
 * every pointer move.
 */
export const startPlanPanelWatch = (clock: PlanClock = windowClock): (() => void) => {
    rules?.dispose();
    const own = new PlanPanelRules(uiIo(clock));
    rules = own;

    const pass = (): void => {
        const ui = useUi.getState();
        const planWidth = ui.planOpen ? Math.max(PLAN_MIN_WIDTH, ui.planWidth ?? PLAN_DEFAULT_WIDTH) : 0;
        own.sight(chatsInSight(liveChatSight(), { planWidth }));
        const { planAnchor, planOpen } = useUi.getState();
        if (planAnchor === null) {
            return;
        }
        const endpointId = currentEndpointId();
        // Undefined is a machine that has not answered yet, which says nothing about the plan.
        if (findPlan(endpointId, planAnchor.chatId, planAnchor.planId) === null) {
            own.gone();
            return;
        }
        if (planOpen && usePlans.getState().unseen[endpointKey(endpointId, planAnchor.chatId)] === planAnchor.planId) {
            usePlans.getState().markSeen(endpointId, planAnchor.chatId);
        }
    };

    let queued = false;
    const schedule = (): void => {
        if (queued) {
            return;
        }
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            pass();
        });
    };

    const offCreated = subscribePlanCreated((endpointId, chatId, planId) => {
        // Measured now rather than a frame ago, so a plan made the moment its chat came up still counts.
        pass();
        if (endpointId !== currentEndpointId() || !own.created(chatId, planId)) {
            usePlans.getState().markUnseen(endpointId, chatId, planId);
        }
    });
    const offCanvases = subscribeCanvases(schedule);
    let offDocument = useDocument.subscribe(schedule);
    const offWorkspace = subscribeCurrentWorkspace(() => {
        offDocument();
        offDocument = useDocument.subscribe(schedule);
        schedule();
    });
    const offPlans = usePlans.subscribe(schedule);
    const offUi = useUi.subscribe((state, before) => {
        if (state.planAnchor !== before.planAnchor || state.planOpen !== before.planOpen || state.planWidth !== before.planWidth) {
            schedule();
        }
    });
    pass();
    return () => {
        offCreated();
        offCanvases();
        offDocument();
        offWorkspace();
        offPlans();
        offUi();
        own.dispose();
        if (rules === own) {
            rules = null;
        }
    };
};
