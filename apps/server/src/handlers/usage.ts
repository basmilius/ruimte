import type { Dispatcher } from '../dispatcher.ts';
import type { UsageMonitor } from '../usage/limits/monitor.ts';
import type { UsageService } from '../usage/usage-service.ts';

export const registerUsageHandlers = (dispatcher: Dispatcher, usage: UsageService, limits: UsageMonitor): void => {
    dispatcher.register('usage.summary', (payload) => usage.summary(payload));

    // While a client has the page open the daemon keeps scanning; every other client gets the event too.
    dispatcher.register('usage.subscribe', (_payload, client) => {
        usage.follow(client.id);
        return {};
    });

    dispatcher.register('usage.unsubscribe', (_payload, client) => {
        usage.unfollow(client.id);
        return {};
    });

    dispatcher.register('usage.limits', () => limits.snapshot());

    dispatcher.register('usage.refreshLimits', async () => {
        await limits.refresh(true);
        return limits.snapshot();
    });
};
