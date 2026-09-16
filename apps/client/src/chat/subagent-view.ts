import { useMemo } from 'react';
import { create } from 'zustand';
import type { ChatItem, ChatSubagentItem } from '@ruimte/contracts';
import { useSubagentSupport } from '@/chat/subagent-support';
import { useChatRow } from '@/state/chats';
import { endpointKey, useEndpointId } from '@/state/keys';

/* One conversation on the way down from the chat: the call that opened it and what that call called it. */
export interface SubagentCrumb {
    toolUseId: string;
    description: string;
}

/* From the subagent the chat opened down to the one on screen, which is the last; empty is the main agent. */
export type SubagentTrail = readonly SubagentCrumb[];

export interface BreadcrumbStep {
    label: string;
    /* How many crumbs of the trail stay when this step is picked: 0 is the main agent. */
    depth: number;
    current: boolean;
}

export const MAIN_AGENT: SubagentTrail = [];

const NO_ITEMS: readonly string[] = [];

export const crumbOf = (item: ChatSubagentItem): SubagentCrumb => ({ toolUseId: item.toolUseId, description: item.description });

export const crumbLabel = (crumb: SubagentCrumb): string => crumb.description || 'Sub-agent';

/* A subagent of the main agent replaces whatever was shown, since the overview and the thread both list the main agent's. */
export const openFromMain = (crumb: SubagentCrumb): SubagentTrail => [crumb];

export const openBelow = (trail: SubagentTrail, crumb: SubagentCrumb): SubagentTrail => [...trail, crumb];

export const trailTo = (trail: SubagentTrail, depth: number): SubagentTrail => (depth <= 0 ? MAIN_AGENT : trail.slice(0, depth));

export const stepBack = (trail: SubagentTrail): SubagentTrail => trailTo(trail, trail.length - 1);

/* A subagent's conversation is read back, so there is nobody to write to while one is shown. */
export const showsComposer = (trail: SubagentTrail): boolean => trail.length === 0;

export const breadcrumbOf = (trail: SubagentTrail): BreadcrumbStep[] => [
    { label: 'Main agent', depth: 0, current: trail.length === 0 },
    ...trail.map((crumb, index) => ({ label: crumbLabel(crumb), depth: index + 1, current: index === trail.length - 1 }))
];

/* A row without a pointer of its own can only be opened by a machine that answers `chat.subagent` for it. */
export const canOpenSubagent = (item: ChatSubagentItem, machineRefused: boolean): boolean => item.native !== undefined || !machineRefused;

/* The subagents a chat can open, in the order the thread has them. */
export const openableSubagents = (order: readonly string[], structure: Record<string, ChatItem>, machineRefused: boolean): ChatSubagentItem[] =>
    order.flatMap((id) => {
        const item = structure[id];
        return item?.kind === 'subagent' && canOpenSubagent(item, machineRefused) ? [item] : [];
    });

interface SubagentViewStore {
    /* Keyed `${endpointId}:${chatId}`; a chat on its main agent has no entry. */
    trails: Record<string, SubagentTrail>;
    show(key: string, trail: SubagentTrail): void;
    /* One level up; false when the main agent was already on screen, so the key can mean something else. */
    back(key: string): boolean;
}

/*
 * Which conversation a chat shows, for this page's life only: a look into a subagent is a moment
 * rather than a place, so it is never written to the project or to the machine.
 */
export const useSubagentView = create<SubagentViewStore>((set, get) => ({
    trails: {},
    show(key, trail) {
        const trails = { ...get().trails };
        if (trail.length === 0) {
            delete trails[key];
        } else {
            trails[key] = trail;
        }
        set({ trails });
    },
    back(key) {
        const trail = get().trails[key];
        if (trail === undefined || trail.length === 0) {
            return false;
        }
        get().show(key, stepBack(trail));
        return true;
    }
}));

/* The trail of a chat in the workspace this is rendered in, and a way to set it. */
export const useSubagentTrail = (chatId: string): { trail: SubagentTrail; show(trail: SubagentTrail): void } => {
    const key = endpointKey(useEndpointId(), chatId);
    const trail = useSubagentView((s) => s.trails[key] ?? MAIN_AGENT);
    return { trail, show: (next) => useSubagentView.getState().show(key, next) };
};

export const useOpenableSubagents = (chatId: string): ChatSubagentItem[] => {
    const endpointId = useEndpointId();
    const refused = useSubagentSupport((s) => s.unsupported[endpointId] === true);
    // The structure and not the items, so a delta growing a reply does not walk the thread again.
    const order = useChatRow(chatId, (row) => row?.order);
    const structure = useChatRow(chatId, (row) => row?.structure);
    return useMemo(() => (structure === undefined ? [] : openableSubagents(order ?? NO_ITEMS, structure, refused)), [order, structure, refused]);
};

/* Whether a chat has anything for the sub-agent controls: a subagent to pick, or one already on screen. */
export const useHasSubagentControls = (chatId: string): boolean => {
    const subagents = useOpenableSubagents(chatId);
    const { trail } = useSubagentTrail(chatId);
    return subagents.length > 0 || trail.length > 0;
};
