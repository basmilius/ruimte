import type { RuntimeMode } from '@ruimte/contracts';
import { MODE_ORDER, ceilingForOpening } from '@adecore/agents/providers';
import type { VerbCall } from './verb.ts';

export const MODE_FLAG_HELP =
    'omit to keep the default inheritance; set only when the person requests a different permission mode. A read-only or review assignment does not imply supervised';

export const MODE_LINES: readonly string[] = [
    `mode\t${MODE_ORDER.join(' < ')}\tfrom the narrowest to the widest`,
    "mode\tAn agent you open never runs in a wider mode than you: without --mode a chat opened by a chat takes your mode, and anything else takes the person's default narrowed to yours",
    'mode\tCodex supervised restricts writes and asks for command approvals, including reads; use it only when the person requests that permission mode',
    'mode\tA terminal agent counts as the mode its CLI last reported, or else the mode it was started in; one the machine cannot tell counts as supervised'
];

export function modeForOpening(call: VerbCall, requested: RuntimeMode | undefined): RuntimeMode {
    return ceilingForOpening(call.host.starts.modeOf(call.caller), requested);
}
