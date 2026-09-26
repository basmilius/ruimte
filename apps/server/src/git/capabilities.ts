import type { GitCapabilitiesResult } from '@ruimte/contracts';
import { detectCli } from '@ruimte/agents/providers/detect';
import type { ProviderRegistry } from '../providers/registry.ts';

// An install shows up on the next check; a probe per menu open would cost a process every time.
const TTL_MS = 60_000;

let cached: { at: number; gh: boolean } | null = null;

/* Only for the tests, which install and uninstall nothing but still want a fresh answer. */
export const forgetCapabilities = (): void => {
    cached = null;
};

/*
 * What this machine lets the panel offer: a pull request needs `gh` on the daemon's PATH, and the
 * "Write message" button needs an agent CLI that answers a single prompt. A client hides what is
 * not there instead of showing a button that fails.
 */
export const readCapabilities = async (registry: ProviderRegistry, now: number = Date.now()): Promise<GitCapabilitiesResult> => {
    if (cached === null || now - cached.at >= TTL_MS) {
        cached = { at: now, gh: (await detectCli('gh')).installed };
    }
    const provider = await registry.oneShotProvider();
    return { gh: cached.gh, messageProvider: provider?.kind ?? null };
};
