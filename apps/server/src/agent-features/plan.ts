import { planActions, planPreviews } from '../actions/plan-actions.ts';
import { planToolkit } from '../tools/plan-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const planFeature = defineAgentFeature({
    name: 'plan',
    toolkit: planToolkit,
    actions: planActions,
    previews: planPreviews,
    host: ({ agents }) => ({ plans: agents.plans })
});
