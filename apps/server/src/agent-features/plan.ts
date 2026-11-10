import { planActions, planPreviews } from '../actions/plan-actions.ts';
import type { PlanStore } from '../plans/plan-store.ts';
import { planToolkit } from '../tools/plan-tools.ts';
import { defineAgentFeature } from './feature.ts';

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The plans of the caller's own chat, kept beside its record. */
        plans: Pick<PlanStore, 'read' | 'create' | 'apply' | 'delete'>;
    }
}

export const planFeature = defineAgentFeature({
    name: 'plan',
    toolkit: planToolkit,
    actions: planActions,
    previews: planPreviews,
    host: ({ agents }) => ({ plans: agents.plans })
});
