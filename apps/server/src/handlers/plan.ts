import { CodedError } from '@adecore/agents';
import type { Area } from '../area.ts';
import { type Dispatcher } from '../dispatcher.ts';
import type { PlanStore } from '../plans/plan-store.ts';

interface PlanDeps {
    plans: PlanStore;
}

/* A client connection is always a person. The structure of a plan belongs to the agent, through its tools. */
export function planArea(deps: PlanDeps): Area {
    return { name: 'plan', sources: [deps.plans], handlers: (dispatcher) => registerRequests(dispatcher, deps) };
}

function registerRequests(dispatcher: Dispatcher, { plans }: PlanDeps): void {
    dispatcher.register('plan.list', async ({ chatIds }) => ({ plans: await plans.list(chatIds) }));

    dispatcher.register('plan.apply', async ({ chatId, planId, ops }) => {
        const applied = await plans.apply(chatId, planId, ops, 'person');
        if (!applied.ok) {
            throw new CodedError(applied.code, applied.message);
        }
        return { plan: applied.plan };
    });
}
