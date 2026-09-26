import i18next from 'i18next';
import { useMemo } from 'react';
import { create } from 'zustand';
import type { ChatItem, ChatSubagentItem } from '@ruimte/contracts';
import { useSubagentSupport } from '@/chat/subagent-support';
import { useChatRow } from '@ruimte/agents-react/state/chats';
import { endpointKey, useEndpointId } from '@/state/keys';

/* One conversation on the way down from the chat: the call that opened it and what that call called it. */
export interface SubagentStep {
    toolUseId: string;
    description: string;
}

/* From the chat down to what is on screen, which is the last step; empty is the main agent. */
export type SubagentTrail = readonly SubagentStep[];

export interface BreadcrumbStep {
    label: string;
    /* How many steps of the trail stay when this crumb is picked; the chat's own title is 0. */
    depth: number;
    current: boolean;
}

export const MAIN_AGENT: SubagentTrail = [];

const NO_ITEMS: readonly string[] = [];

export const crumbOf = (item: ChatSubagentItem): SubagentStep => ({ toolUseId: item.toolUseId, description: item.description });

const stepLabel = (step: SubagentStep): string => step.description || i18next.t('chat:rows.subagent.label');

/* A row in the main agent's thread or an entry of the flyout opens its conversation straight away. */
export const openFromMain = (step: SubagentStep): SubagentTrail => [step];

export const openBelow = (trail: SubagentTrail, step: SubagentStep): SubagentTrail => [...trail, step];

export const trailTo = (trail: SubagentTrail, depth: number): SubagentTrail => (depth <= 0 ? MAIN_AGENT : trail.slice(0, depth));

export const stepBack = (trail: SubagentTrail): SubagentTrail => trailTo(trail, trail.length - 1);

/* A sub-agent's conversation is read back, so there is nobody to write to. */
export const showsComposer = (trail: SubagentTrail): boolean => trail.length === 0;

/* The crumbs after the chat's own title, which the bar draws as the first crumb and the way back. */
export const breadcrumbOf = (trail: SubagentTrail): BreadcrumbStep[] =>
    trail.map((step, index) => ({ label: stepLabel(step), depth: index + 1, current: index === trail.length - 1 }));

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
 * What a chat shows in its place, for this page's life only: a look into a subagent is a moment
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
