import { AGENT_FEATURES } from '../agent-features/list.ts';
import { createServerActions } from './server-actions.ts';

/* One registry for a test file to execute actions on, as the wiring makes one for the daemon. */
export const serverActions = createServerActions(AGENT_FEATURES);
