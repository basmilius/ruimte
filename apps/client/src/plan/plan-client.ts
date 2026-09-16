import type { Plan, PlanPersonOp, PlanStepState } from '@ruimte/contracts';
import { applyPlanOps } from '@ruimte/plan';
import { endpointKey } from '@/state/keys';
import { usePlans } from '@/state/plans';
import { useToasts } from '@/state/toasts';
import type { Transport } from '@/transport/transport';

/* What a plan write needs of the stores, so a test hands in its own. */
export interface PlanWriteSink {
    current(endpointId: string, chatId: string, planId: string): Plan | undefined;
    put(endpointId: string, chatId: string, plan: Plan): void;
    failed(message: string): void;
}

const storeSink: PlanWriteSink = {
    current: (endpointId, chatId, planId) => usePlans.getState().byChat[endpointKey(endpointId, chatId)]?.find((plan) => plan.id === planId),
    put: (endpointId, chatId, plan) => usePlans.getState().putPlan(endpointId, chatId, plan),
    failed: (message) => {
        useToasts.getState().show({ kind: 'error', title: 'The plan did not change', description: message });
    }
};

/*
 * A person's changes to a plan. The tick shows at once, from the same rules the daemon runs, and the
 * daemon's answer replaces it; a refusal puts the plan back as it was, unless something newer came in
 * meanwhile, which already says what the plan is.
 */
export class PlanClient {
    private readonly transport: (endpointId: string) => Transport | null;
    private readonly sink: PlanWriteSink;
    private readonly now: () => string;

    constructor(transport: (endpointId: string) => Transport | null, sink: PlanWriteSink = storeSink, now: () => string = () => new Date().toISOString()) {
        this.transport = transport;
        this.sink = sink;
        this.now = now;
    }

    async apply(endpointId: string, chatId: string, planId: string, ops: PlanPersonOp[]): Promise<boolean> {
        const transport = this.transport(endpointId);
        const before = this.sink.current(endpointId, chatId, planId);
        if (transport === null || before === undefined) {
            return false;
        }
        const local = applyPlanOps(before, ops, { actor: 'person', now: this.now() });
        if (!local.ok) {
            this.sink.failed(local.message);
            return false;
        }
        this.sink.put(endpointId, chatId, local.plan);
        try {
            const { plan } = await transport.request('plan.apply', { chatId, planId, ops });
            this.sink.put(endpointId, chatId, plan);
            return true;
        } catch (error) {
            if (this.sink.current(endpointId, chatId, planId) === local.plan) {
                this.sink.put(endpointId, chatId, { ...before, rev: local.plan.rev });
            }
            this.sink.failed(error instanceof Error ? error.message : String(error));
            return false;
        }
    }

    setState(endpointId: string, chatId: string, planId: string, ids: string[], state: PlanStepState, note?: string): Promise<boolean> {
        return this.apply(endpointId, chatId, planId, [{ op: 'set', ids, state, ...(note === undefined ? {} : { note }) }]);
    }

    note(endpointId: string, chatId: string, planId: string, id: string, text: string): Promise<boolean> {
        return this.apply(endpointId, chatId, planId, [{ op: 'note', id, text }]);
    }

    unlock(endpointId: string, chatId: string, planId: string, ids: string[] | 'all'): Promise<boolean> {
        return this.apply(endpointId, chatId, planId, [{ op: 'unlock', ids }]);
    }
}
