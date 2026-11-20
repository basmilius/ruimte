import { lazyDialog } from '@adecore/ui';
import { agentDesignDialog } from '@/design/agent-design-dialog';
import type { DialogContribution } from '@/registry/dialogs';

const AgentDesignOverlay = lazyDialog(
    () => import('@/design/AgentDesignOverlay'),
    'AgentDesignOverlay',
    agentDesignDialog.store,
    (state) => state.request !== null
);

/* The overlay brings its own boundary, so a design that fails to draw keeps its close button. */
export const DESIGN_DIALOGS: readonly DialogContribution[] = [{ id: 'agent-design', surface: null, component: AgentDesignOverlay }];
