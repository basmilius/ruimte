import { ProviderPlatformSchema, type ProviderPlatform } from '@ruimte/contracts';
import { useServers } from '@/state/server';

/* The system a machine reported, as an install command names it; null for one no command is written for. */
export function machinePlatform(platform: string | null): ProviderPlatform | null {
    const parsed = ProviderPlatformSchema.safeParse(platform);
    return parsed.success ? parsed.data : null;
}

/* The system of a machine from its hello, null until it said one. */
export function useMachinePlatform(endpointId: string): ProviderPlatform | null {
    return machinePlatform(useServers((s) => s.byEndpoint[endpointId]?.platform ?? null));
}
