import { usageHandlers } from '@adecore/agents/host/handlers';
import type { UsageMonitor } from '@adecore/agents/usage/limits/monitor';
import type { UsageService } from '@adecore/agents/usage/usage-service';
import type { Dispatcher } from '../dispatcher.ts';
import { registerAgentHandlers } from './agent.ts';

export function registerUsageHandlers(dispatcher: Dispatcher, usage: UsageService, limits: UsageMonitor): void {
    registerAgentHandlers(dispatcher, usageHandlers(usage, limits));
}
