import { lazyDialog } from '@adecore/ui';
import { agentIntegrationsDialog } from '@/controllers/agent-integrations';
import type { DialogContribution } from '@/registry/dialogs';

const AgentIntegrationsDialog = lazyDialog(
    () => import('@/agents/AgentIntegrationsDialog'),
    'AgentIntegrationsDialog',
    agentIntegrationsDialog.store,
    (state) => state.open
);

export const AGENT_DIALOGS: readonly DialogContribution[] = [{ id: 'agent-integrations', surface: 'agentIntegrations', component: AgentIntegrationsDialog }];
