import type { Area } from '../area.ts';
import type { AuthStore } from '../auth/auth-store.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import { fileUsageStore, usageStatePath, UsageCounter } from '../stats/usage-counter.ts';
import { UsageReporter } from '../stats/usage-reporter.ts';
import { installUsageCounter } from '../stats/usage-stats.ts';
import { stopTelemetry, telemetryBuild, type Launcher } from '../telemetry/reporter.ts';
import { VERSION } from '../version.ts';

export interface UsageStatsBundle {
    // Sends the finished days; asked beside the model catalogs, at the start and on `provider.list`.
    flush(): void;
    changed(on: boolean): Promise<void>;
    stop(): Promise<void>;
}

const SILENT: UsageStatsBundle = { flush: () => undefined, changed: () => Promise.resolve(), stop: () => Promise.resolve() };

/* Only a release build counts and sends, the same stamp the crash reports go by; any other build has nothing. */
export async function wireUsageStats(home: string, identity: EndpointIdentity, auth: AuthStore, launcher: Launcher): Promise<UsageStatsBundle> {
    if (!telemetryBuild()) {
        return SILENT;
    }
    const counter = new UsageCounter({ store: fileUsageStore(usageStatePath(home)), describe: () => ({ version: VERSION, launcher }) });
    await counter.load();
    installUsageCounter(counter, () => identity.usageStats);
    if (identity.usageStats) {
        counter.touch();
    }
    const reporter = new UsageReporter({
        counter,
        enabled: () => identity.usageStats,
        signedIn: async () => {
            const binding = await auth.accountBinding();
            return binding !== null && binding !== undefined;
        }
    });
    return {
        flush: () => void reporter.flush(),
        changed: async (on) => {
            if (!on) {
                await counter.discard();
            }
        },
        stop: () => counter.persist()
    };
}

/* Written in the last phase, before the plan limits as main did, so what was counted while stopping is in. */
export function usageCountsLifecycle({ stop }: UsageStatsBundle): Area {
    return {
        name: 'usage counts',
        stop: [{ phase: 'last', label: 'Writing the usage counts', run: () => stop() }]
    };
}

/* Last of the areas that hold something, so what failed while stopping is still sent. */
export function errorReportsLifecycle(): Area {
    return {
        name: 'error reports',
        stop: [{ phase: 'last', label: 'Sending error reports', run: () => stopTelemetry() }]
    };
}
