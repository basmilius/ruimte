import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import type { Area, EventSource } from '../area.ts';
import { bestEffort } from '../best-effort.ts';

// However many clients come back at once, the CLIs are probed again at most this often.
export const PROVIDER_DETECT_INTERVAL_MS = 10_000;

interface DetectableProviders {
    kinds(): AgentKind[];
    invalidate(kind: AgentKind): void;
    list(): Promise<ProviderInfo[]>;
}

interface ProviderDetectDeps {
    providers: DetectableProviders;
    accounts: { refresh(): Promise<unknown> };
    /* What tells every client the list of providers changed. */
    feed: EventSource;
    now(): number;
}

/*
 * A client asks this when a person comes back (a window's focus, the Providers pane, a menu that starts an
 * agent), so a CLI installed meanwhile shows up without the daemon polling on a clock. Any client may ask.
 */
export function providerDetectArea({ providers, accounts, feed, now }: ProviderDetectDeps): Area {
    return {
        name: 'provider detect',
        sources: [feed],
        handlers: (dispatcher) => {
            let forgotAt: number | null = null;
            dispatcher.register('provider.detect', async () => {
                if (forgotAt === null || now() - forgotAt >= PROVIDER_DETECT_INTERVAL_MS) {
                    forgotAt = now();
                    for (const kind of providers.kinds()) {
                        providers.invalidate(kind);
                    }
                    // An account reads its CLI on a clock of its own, so a login made meanwhile would wait for it; its new state reaches clients as an event.
                    void bestEffort('accounts.refresh', accounts.refresh());
                }
                return { providers: await providers.list() };
            });
        }
    };
}
