import { RuntimeModeSchema, type RuntimeMode } from '@ruimte/contracts';
import { z } from 'zod';
import { VerbRefusal, type VerbCall } from './verb.ts';

/*
 * Every CLI's flags widen in this order (see `RUNTIME_FLAGS` and the Codex thread options), and where
 * two modes share a flag clamping down grants the same, never more. So one order serves every CLI.
 */
const ORDER = RuntimeModeSchema.options;

const rankOf = (mode: RuntimeMode): number => ORDER.indexOf(mode);

export const narrowerMode = (mode: RuntimeMode, ceiling: RuntimeMode): RuntimeMode => (rankOf(mode) <= rankOf(ceiling) ? mode : ceiling);

export const MODE_LINES: readonly string[] = [
    `mode\t${ORDER.join(' < ')}\tfrom the narrowest to the widest`,
    "mode\tAn agent you open never runs in a wider mode than you: without --mode a chat opened by a chat takes your mode, and anything else takes the person's default narrowed to yours",
    'mode\tA terminal agent counts as the mode its CLI was started in; one the machine cannot tell counts as supervised'
];

const modeLines = (mine: RuntimeMode): string[] => [
    `mode\tyou\t${mine}`,
    ...ORDER.filter((mode) => rankOf(mode) <= rankOf(mine)).map((mode) => `mode\t${mode}\tallowed`)
];

/*
 * The mode an agent opened by this call may get at most, refusing a `--mode` above it. The ceiling is
 * the caller's own mode, so a chain of agents can only ever narrow what it may do, never widen it.
 */
export const modeForOpening = (call: VerbCall, requested: RuntimeMode | undefined): RuntimeMode => {
    const mine = call.host.modeOf(call.caller);
    if (requested !== undefined && rankOf(requested) > rankOf(mine)) {
        throw new VerbRefusal(
            'mode-above-parent',
            `You run in ${mine} and --mode ${requested} is wider; an agent you open runs in your mode or a narrower one`,
            modeLines(mine)
        );
    }
    return mine;
};

export const modeFlag = z.enum(ORDER, { error: `--mode is one of ${ORDER.join(', ')}` }).optional();
