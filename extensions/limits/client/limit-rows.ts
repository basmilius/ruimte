import type { useUsageLimits } from '@ruimte/extension/client';

const NEAR_LIMIT = 0.7;

export interface LimitRow {
    key: string;
    label: string;
    percent: number;
    near: boolean;
}

/* One row per plan window of every provider, in the order the machine reports them. */
export function limitRows(providers: ReturnType<typeof useUsageLimits>): LimitRow[] {
    return providers.flatMap((provider) =>
        provider.windows.map((window) => ({
            key: `${provider.provider}/${window.label}`,
            label: `${provider.provider}, ${window.label}`,
            percent: Math.round(window.used * 100),
            near: window.used >= NEAR_LIMIT
        }))
    );
}
