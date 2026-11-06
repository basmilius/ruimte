import { lazyDialog } from '@adecore/ui';
import { EndChildrenDialog } from '@/agents/EndChildrenDialog';
import { createFlagState } from '@/registry/dialog-state';
import type { DialogContribution } from '@/registry/dialogs';

/* The consent for the CLIs' global settings is up (`controllers/agent-integrations.ts`). */
export const agentIntegrationsDialog = createFlagState();

const AgentIntegrationsDialog = lazyDialog(
    () => import('@/agents/AgentIntegrationsDialog'),
    'AgentIntegrationsDialog',
    agentIntegrationsDialog.store,
    (state) => state.open
);

export const AGENT_DIALOGS: readonly DialogContribution[] = [{ id: 'agent-integrations', surface: 'agentIntegrations', component: AgentIntegrationsDialog }];

export const AGENT_WORKSPACE_DIALOGS: readonly DialogContribution[] = [{ id: 'end-children', surface: 'dialog', component: EndChildrenDialog }];
