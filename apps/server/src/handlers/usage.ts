import { usageHandlers } from '@adecore/agents/host';
import type { UsageMonitor, UsageService } from '@adecore/agents/usage';
import type { Area } from '../area.ts';
import { registerAgentHandlers } from './agent.ts';

interface UsageDeps {
    usage: UsageService;
    limits: UsageMonitor;
}

export function usageArea({ usage, limits }: UsageDeps): Area {
    // Started before anything is awaited, awaited once the rest has stopped: the numbers are on disk by then.
    let limitsKept: Promise<void> = Promise.resolve();

    return {
        name: 'usage',
        sources: [usage, limits],
        handlers: (dispatcher) => registerAgentHandlers(dispatcher, usageHandlers(usage, limits)),
        stop: [
            { phase: 'halt', label: 'Stopping usage', run: () => usage.stop() },
            {
                phase: 'halt',
                label: 'Stopping limits',
                run: () => {
                    limitsKept = limits.stop();
                }
            },
            { phase: 'last', label: 'Writing the plan limits', run: () => limitsKept }
        ]
    };
}
