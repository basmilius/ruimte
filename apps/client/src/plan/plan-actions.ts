import { create } from 'zustand';
import { isCanvasView } from '@ruimte/contracts';
import { PlanClient } from '@/plan/plan-client';
import type { PlanFilter } from '@/plan/plan-view';
import { revealNode, showView } from '@/project/views';
import { liveCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { machineFor } from '@/transport/connections';

export const planClient = new PlanClient((endpointId) => machineFor(endpointId)?.transport ?? null);

interface PlanViewPrefs {
    filter: PlanFilter;
    collapseDone: boolean;
    /* Folded sections and parent steps, by `endpointKey` of the chat and the plan id. */
    collapsed: Readonly<Record<string, readonly string[]>>;
    setFilter(filter: PlanFilter): void;
    setCollapseDone(on: boolean): void;
    toggleCollapsed(planKey: string, itemId: string): void;
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
    }
}));

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
