import { EndChildrenDialog } from '@/agents/EndChildrenDialog';
import type { DialogContribution } from '@/registry/dialogs';

/* Only the workspace's dialog list reaches this, so it loads with the workspace. */
export const AGENT_WORKSPACE_DIALOGS: readonly DialogContribution[] = [{ id: 'end-children', surface: 'dialog', component: EndChildrenDialog }];
