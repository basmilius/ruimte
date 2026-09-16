import { create } from 'zustand';
import type { Plan, PlanOfChat } from '@ruimte/contracts';
import { dropEndpoint, endpointKey, isOfEndpoint, useEndpointId } from '@/state/keys';
import type { Transport } from '@/transport/transport';

/* A chat's plans, newest first: the panel and the pill show the first one unless a person picks another. */
export type ChatPlans = readonly Plan[];

const NO_PLANS: ChatPlans = [];

const newestFirst = (plans: readonly Plan[]): Plan[] =>
    [...plans].sort((one, other) => other.createdAt.localeCompare(one.createdAt) || other.id.localeCompare(one.id));

interface PlansStore {
    /* Keyed with `endpointKey(endpointId, chatId)`. */
    byChat: Readonly<Record<string, ChatPlans>>;
    /* The machines that answered `plan.list`: before that, a plan missing here may just not have arrived. */
    loaded: Readonly<Record<string, true>>;
    /* The chats with a plan made while nobody was looking at them, by chat key, with that plan's id. */
    unseen: Readonly<Record<string, string>>;
    setMachinePlans(endpointId: string, plans: readonly PlanOfChat[]): void;
    putPlan(endpointId: string, chatId: string, plan: Plan): void;
    removePlan(endpointId: string, chatId: string, planId: string): void;
    markUnseen(endpointId: string, chatId: string, planId: string): void;
    markSeen(endpointId: string, chatId: string): void;
    forget(endpointId: string): void;
}

export const usePlans = create<PlansStore>((set, get) => ({
    byChat: {},
    loaded: {},
    unseen: {},
    setMachinePlans(endpointId, plans) {
        const grouped: Record<string, Plan[]> = {};
        for (const { chatId, plan } of plans) {
            (grouped[endpointKey(endpointId, chatId)] ??= []).push(plan);
        }
        const byChat: Record<string, ChatPlans> = dropEndpoint(get().byChat, endpointId);
        for (const [key, list] of Object.entries(grouped)) {
            byChat[key] = newestFirst(list);
        }
        const unseen = Object.fromEntries(
            Object.entries(get().unseen).filter(([key, planId]) => !isOfEndpoint(key, endpointId) || byChat[key]?.some((plan) => plan.id === planId))
        );
        set({ byChat, unseen, loaded: { ...get().loaded, [endpointId]: true } });
    },
    putPlan(endpointId, chatId, plan) {
        const key = endpointKey(endpointId, chatId);
        const current = get().byChat[key] ?? NO_PLANS;
        const existing = current.find((entry) => entry.id === plan.id);
        // A reply and an event can cross; the older of the two says nothing the newer one does not.
        if (existing && existing.rev > plan.rev) {
            return;
        }
        set({ byChat: { ...get().byChat, [key]: newestFirst([...current.filter((entry) => entry.id !== plan.id), plan]) } });
    },
    removePlan(endpointId, chatId, planId) {
        const key = endpointKey(endpointId, chatId);
        const current = get().byChat[key];
        if (!current?.some((plan) => plan.id === planId)) {
            return;
        }
        const rest = current.filter((plan) => plan.id !== planId);
        const byChat = { ...get().byChat };
        if (rest.length === 0) {
            delete byChat[key];
        } else {
            byChat[key] = rest;
        }
        const unseen = { ...get().unseen };
        if (unseen[key] === planId) {
            delete unseen[key];
        }
        set({ byChat, unseen });
    },
    markUnseen(endpointId, chatId, planId) {
        set({ unseen: { ...get().unseen, [endpointKey(endpointId, chatId)]: planId } });
    },
    markSeen(endpointId, chatId) {
        const key = endpointKey(endpointId, chatId);
        if (get().unseen[key] === undefined) {
            return;
        }
        const unseen = { ...get().unseen };
        delete unseen[key];
        set({ unseen });
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...loaded } = get().loaded;
        set({ byChat: dropEndpoint(get().byChat, endpointId), unseen: dropEndpoint(get().unseen, endpointId), loaded });
    }
}));

export const plansOf = (endpointId: string, chatId: string): ChatPlans => usePlans.getState().byChat[endpointKey(endpointId, chatId)] ?? NO_PLANS;

/* One plan of a chat; undefined while the machine has not answered yet, null once it has and the plan is not there. */
export const findPlan = (endpointId: string, chatId: string, planId: string): Plan | null | undefined => {
    const found = plansOf(endpointId, chatId).find((plan) => plan.id === planId);
    if (found) {
        return found;
    }
    return usePlans.getState().loaded[endpointId] ? null : undefined;
};

/* The plans of a chat on the machine in scope. The stored array itself, so a render only follows that chat. */
export const useChatPlans = (chatId: string): ChatPlans => {
    const endpointId = useEndpointId();
    return usePlans((s) => s.byChat[endpointKey(endpointId, chatId)] ?? NO_PLANS);
};

export const useHasPlans = (chatId: string): boolean => useChatPlans(chatId).length > 0;

type CreatedListener = (endpointId: string, chatId: string, planId: string) => void;

const createdListeners = new Set<CreatedListener>();

/* `plan.created`, which is the one event the panel's anchor moves on; a change to a plan never moves it. */
export const subscribePlanCreated = (listener: CreatedListener): (() => void) => {
    createdListeners.add(listener);
    return () => {
        createdListeners.delete(listener);
    };
};

/*
 * The plans of one machine, kept in step with it. The daemon tells every socket about every plan, so
 * a pill shows on a chat nobody attached; a socket that opens asks for the whole list again, since
 * what changed while it was closed was told to nobody.
 */
export class PlanSync {
    private readonly off: (() => void)[];
    private generation = 0;
    private readonly endpointId: string;
    private readonly transport: Transport;

    constructor(endpointId: string, transport: Transport) {
        this.endpointId = endpointId;
        this.transport = transport;
        this.off = [
            transport.on('plan.changed', ({ chatId, plan }) => usePlans.getState().putPlan(endpointId, chatId, plan)),
            transport.on('plan.removed', ({ chatId, planId }) => usePlans.getState().removePlan(endpointId, chatId, planId)),
            transport.on('plan.created', ({ chatId, planId }) => {
                for (const listener of [...createdListeners]) {
                    listener(endpointId, chatId, planId);
                }
            }),
            transport.subscribeStatus((status) => {
                this.generation++;
                if (status === 'open') {
                    void this.refresh();
                }
            })
        ];
        if (transport.status === 'open') {
            void this.refresh();
        }
    }

    dispose(): void {
        this.generation++;
        this.off.forEach((off) => off());
        usePlans.getState().forget(this.endpointId);
    }

    private async refresh(): Promise<void> {
        const generation = this.generation;
        try {
            const { plans } = await this.transport.request('plan.list', {});
            if (generation === this.generation) {
                usePlans.getState().setMachinePlans(this.endpointId, plans);
            }
        } catch {
            // A daemon from before plans does not know the request; it simply has none.
        }
    }
}
