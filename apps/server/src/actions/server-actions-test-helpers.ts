import { AGENT_FEATURES } from '../agent-features/list.ts';
import { createServerActions } from './server-actions.ts';

export const serverActions = createServerActions(AGENT_FEATURES);
