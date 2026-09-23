import { ActionRefusal } from '@ruimte/actions';
import type { Plan, PlanPersonOp } from '@ruimte/contracts';
import { applyPlanOps } from '@ruimte/plan';
import { endpointKey } from '@/state/keys';
import { usePlans } from '@/state/plans';
import { TransportError, type Transport } from '@/transport/transport';

/* What a plan write needs of the stores, so a test hands in its own. */
export interface PlanWriteSink {
    current(endpointId: string, chatId: string, planId: string): Plan | undefined;
    put(endpointId: string, chatId: string, plan: Plan): void;
}

const storeSink: PlanWriteSink = {
    current: (endpointId, chatId, planId) => usePlans.getState().byChat[endpointKey(endpointId, chatId)]?.find((plan) => plan.id === planId),
    put: (endpointId, chatId, plan) => usePlans.getState().putPlan(endpointId, chatId, plan)
};

/*
 * A person's changes to a plan. The tick shows at once, from the same rules the daemon runs, and the
 * daemon's answer replaces it; a refusal puts the plan back as it was, unless something newer came in
 * meanwhile, which already says what the plan is. Either refusal comes back under its own code.
 */
export class PlanClient {
    private readonly transport: (endpointId: string) => Pick<Transport, 'request'> | null;
    private readonly sink: PlanWriteSink;
    private readonly now: () => string;

    constructor(
        transport: (endpointId: string) => Pick<Transport, 'request'> | null,
        sink: PlanWriteSink = storeSink,
        now: () => string = () => new Date().toISOString()
    ) {
        this.transport = transport;
        this.sink = sink;
        this.now = now;
    }

    async apply(endpointId: string, chatId: string, planId: string, ops: PlanPersonOp[]): Promise<Plan> {
        const transport = this.transport(endpointId);
        if (transport === null) {
            throw new ActionRefusal('offline', 'The machine of this project is not connected.');
        }
        const before = this.sink.current(endpointId, chatId, planId);
        if (before === undefined) {
            throw new ActionRefusal('plan-not-found', `This chat has no plan ${planId}.`);
        }
        const local = applyPlanOps(before, ops, { actor: 'person', now: this.now() });
        if (!local.ok) {
            throw new ActionRefusal(local.code, local.message);
        }
        this.sink.put(endpointId, chatId, local.plan);
        try {
            const { plan } = await transport.request('plan.apply', { chatId, planId, ops });
            this.sink.put(endpointId, chatId, plan);
            return plan;
        } catch (error) {
            if (this.sink.current(endpointId, chatId, planId) === local.plan) {
                this.sink.put(endpointId, chatId, { ...before, rev: local.plan.rev });
            }
            throw error instanceof TransportError ? new ActionRefusal(error.code, error.message) : error;
        }
    }
}
