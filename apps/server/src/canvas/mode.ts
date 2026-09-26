import type { RuntimeMode } from '@ruimte/contracts';
import { MODE_ORDER, ceilingForOpening } from '@ruimte/agents/modes';
import type { VerbCall } from './verb.ts';

export const MODE_LINES: readonly string[] = [
    `mode\t${MODE_ORDER.join(' < ')}\tfrom the narrowest to the widest`,
    "mode\tAn agent you open never runs in a wider mode than you: without --mode a chat opened by a chat takes your mode, and anything else takes the person's default narrowed to yours",
    'mode\tA terminal agent counts as the mode its CLI last reported, or else the mode it was started in; one the machine cannot tell counts as supervised'
];

export const modeForOpening = (call: VerbCall, requested: RuntimeMode | undefined): RuntimeMode => ceilingForOpening(call.host.modeOf(call.caller), requested);
