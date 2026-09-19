import i18next from 'i18next';
import { create } from 'zustand';
import { isCanvasView, type Plan } from '@ruimte/contracts';
import { planToMarkdown } from '@ruimte/plan';
import { offerDraft } from '@/chat/drafts';
import { PlanClient } from '@/plan/plan-client';
import { foldableIds, resultsText, revealOptions, type PlanFilter } from '@/plan/plan-view';
import { revealNode, showView } from '@/project/views';
import { liveCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { endpointKey } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { machineFor } from '@/transport/connections';
import { copyText } from '@/ui/clipboard';

export const planClient = new PlanClient((endpointId) => machineFor(endpointId)?.transport ?? null);

interface PlanViewPrefs {
    filter: PlanFilter;
    collapseDone: boolean;
    /* Folded sections and parent steps, by `endpointKey` of the chat and the plan id. */
    collapsed: Readonly<Record<string, readonly string[]>>;
    setFilter(filter: PlanFilter): void;
    setCollapseDone(on: boolean): void;
    toggleCollapsed(planKey: string, itemId: string): void;
    setCollapsed(planKey: string, itemIds: readonly string[]): void;
}

const NO_IDS: readonly string[] = [];

/* How this client looks at plans. It stays in this window and never goes into a plan. */
export const usePlanViewPrefs = create<PlanViewPrefs>((set, get) => ({
    filter: 'all',
    collapseDone: false,
    collapsed: {},
    setFilter(filter) {
        set({ filter });
    },
    setCollapseDone(on) {
        set({ collapseDone: on });
    },
    toggleCollapsed(planKey, itemId) {
        const current = get().collapsed[planKey] ?? NO_IDS;
        const next = current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId];
        set({ collapsed: { ...get().collapsed, [planKey]: next } });
    },
    setCollapsed(planKey, itemIds) {
        set({ collapsed: { ...get().collapsed, [planKey]: itemIds } });
    }
}));

export const planViewKey = (endpointId: string, chatId: string, planId: string): string => `${endpointKey(endpointId, chatId)}:${planId}`;

export const collapseAll = (planKey: string, plan: Pick<Plan, 'items'>): void => usePlanViewPrefs.getState().setCollapsed(planKey, foldableIds(plan));

/* Collapse done would keep finished groups folded, and "all" has to mean all. */
export const expandAll = (planKey: string): void => {
    usePlanViewPrefs.getState().setCollapsed(planKey, NO_IDS);
    usePlanViewPrefs.getState().setCollapseDone(false);
};

interface PlanReveal {
    /* The step the list scrolls to and lights up; the nonce makes a second click on the same step count. */
    target: { planKey: string; stepId: string; nonce: number } | null;
    reveal(planKey: string, stepId: string): void;
}

export const usePlanReveal = create<PlanReveal>((set, get) => ({
    target: null,
    reveal(planKey, stepId) {
        set({ target: { planKey, stepId, nonce: (get().target?.nonce ?? 0) + 1 } });
    }
}));

/* Opens what hides a step in the list, then asks the list to bring it into view. */
export const revealPlanStep = (planKey: string, plan: Pick<Plan, 'items'>, stepId: string): void => {
    const prefs = usePlanViewPrefs.getState();
    const current = { filter: prefs.filter, collapseDone: prefs.collapseDone, collapsed: new Set(collapsedOf(prefs.collapsed, planKey)) };
    const next = revealOptions(plan, current, stepId);
    if (next.filter !== current.filter) {
        prefs.setFilter(next.filter);
    }
    if (next.collapseDone !== current.collapseDone) {
        prefs.setCollapseDone(next.collapseDone);
    }
    if (next.collapsed.size !== current.collapsed.size) {
        prefs.setCollapsed(planKey, [...next.collapsed]);
    }
    usePlanReveal.getState().reveal(planKey, stepId);
};

export const collapsedOf = (collapsed: PlanViewPrefs['collapsed'], planKey: string): readonly string[] => collapsed[planKey] ?? NO_IDS;

/* The keyboard and the eye to a chat: its cell when it stands in one, else the camera to its node. */
export const focusChat = (chatId: string): void => {
    const { views, layout, setActiveView } = useDocument.getState();
    if (views.some((view) => view.kind === 'chat' && view.id === chatId)) {
        showView(chatId);
        return;
    }
    const inCells = new Set(layout?.columns.flatMap((column) => column.cells.map((cell) => cell.viewId)) ?? []);
    const holding = views.find((view) => isCanvasView(view) && inCells.has(view.id) && liveCanvas(view.id)?.nodes[chatId] !== undefined);
    if (holding) {
        setActiveView(holding.id);
        liveCanvas(holding.id)?.goToNode(chatId);
        return;
    }
    revealNode(chatId);
};

export const copyPlanMarkdown = (plan: Plan): void => {
    copyText(planToMarkdown(plan));
    useToasts.getState().show({ kind: 'success', title: i18next.t('plan:toast.copied') });
};

/*
 * Puts the failed and blocked steps in the chat's prompt, and never sends it: the person does. The
 * chat comes into focus as well, so the text is in front of them.
 */
export const sendResultsToChat = (chatId: string, plan: Plan): void => {
    const text = resultsText(plan);
    if (text === null) {
        return;
    }
    offerDraft(chatId, text);
    focusChat(chatId);
};
