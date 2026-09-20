import { RequestError, type Dispatcher } from '../dispatcher.ts';
import type { PlanStore } from '../plans/plan-store.ts';

/* A client connection is always a person. The structure of a plan belongs to the agent, through its verbs. */
export const registerPlanHandlers = (dispatcher: Dispatcher, plans: PlanStore): void => {
    dispatcher.register('plan.list', async ({ chatIds }) => ({ plans: await plans.list(chatIds) }));

    dispatcher.register('plan.apply', async ({ chatId, planId, ops }) => {
        const applied = await plans.apply(chatId, planId, ops, 'person');
        if (!applied.ok) {
            throw new RequestError(applied.code, applied.message);
        }
        return { plan: applied.plan };
    });
};
