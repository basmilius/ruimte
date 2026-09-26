import { usageHandlers } from '@ruimte/agents/host/handlers';
import type { UsageMonitor } from '@ruimte/agents/usage/limits/monitor';
import type { UsageService } from '@ruimte/agents/usage/usage-service';
import type { Dispatcher } from '../dispatcher.ts';
import { registerAgentHandlers } from './agent.ts';

export const registerUsageHandlers = (dispatcher: Dispatcher, usage: UsageService, limits: UsageMonitor): void => {
    registerAgentHandlers(dispatcher, usageHandlers(usage, limits));
};
