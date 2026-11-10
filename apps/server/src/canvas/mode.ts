import { ceilingForOpening, MODE_ORDER } from '@adecore/agents/providers';
import type { RuntimeMode } from '@ruimte/contracts';
import type { AgentCall } from './host.ts';

/*
 * The mode an agent this call opens starts in. A client elsewhere has no node whose mode could cap it, so the
 * ceiling on its credential does; either way a child never gets a wider mode than its parent.
 */
export function modeForOpening(call: AgentCall, requested: RuntimeMode | undefined): RuntimeMode {
    return ceilingForOpening(call.external?.grant.ceiling ?? call.host.starts.modeOf(call.caller), requested);
}

/* How wide a mode is: a higher number allows more. */
export function modeRank(mode: RuntimeMode): number {
    return MODE_ORDER.indexOf(mode);
}
