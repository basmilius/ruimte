import type { RuntimeMode } from '@ruimte/contracts';
import { ceilingForOpening } from '@adecore/agents/providers';
import type { AgentCall } from './host.ts';

export function modeForOpening(call: AgentCall, requested: RuntimeMode | undefined): RuntimeMode {
    return ceilingForOpening(call.host.starts.modeOf(call.caller), requested);
}
