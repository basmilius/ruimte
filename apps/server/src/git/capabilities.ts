import type { AgentKind, GitCapabilitiesResult } from '@ruimte/contracts';
import type { ProviderRegistry } from '../providers/registry.ts';

/*
 * What this machine lets the panel offer: the "Write message" button needs an agent CLI that answers
 * a single prompt. A client hides what is not there instead of showing a button that fails.
 */
export async function readCapabilities(registry: ProviderRegistry, chosen?: AgentKind): Promise<GitCapabilitiesResult> {
    // The machine's pick is reported even when it cannot write now, so a client sending that kind is told why instead of falling back.
    const provider = chosen === undefined ? await registry.oneShotProvider() : null;
    // Pull requests left Ruimte; an older client still reads `gh` and hides what it would offer for them.
    return { gh: false, messageProvider: chosen ?? provider?.kind ?? null, amend: true };
}
