import { RuntimeModeSchema, type RuntimeMode } from '@ruimte/agent-contracts';
import { z } from 'zod';
import { VerbRefusal } from './context/verb.ts';

/*
 * Every CLI's flags widen in this order (its permission flags and the Codex thread options), and where
 * two modes share a flag clamping down grants the same, never more. So one order serves every CLI.
 */
export const MODE_ORDER = RuntimeModeSchema.options;

const rankOf = (mode: RuntimeMode): number => MODE_ORDER.indexOf(mode);

export const narrowerMode = (mode: RuntimeMode, ceiling: RuntimeMode): RuntimeMode => (rankOf(mode) <= rankOf(ceiling) ? mode : ceiling);

const modeLines = (mine: RuntimeMode): string[] => [
    `mode\tyou\t${mine}`,
    ...MODE_ORDER.filter((mode) => rankOf(mode) <= rankOf(mine)).map((mode) => `mode\t${mode}\tallowed`)
];

/*
 * The mode an agent the opener opens may get at most, refusing a `--mode` above it. The ceiling is
 * the opener's own mode, so a chain of agents can only ever narrow what it may do, never widen it.
 */
export const ceilingForOpening = (opener: RuntimeMode, requested: RuntimeMode | undefined): RuntimeMode => {
    if (requested !== undefined && rankOf(requested) > rankOf(opener)) {
        throw new VerbRefusal(
            'mode-above-parent',
            `You run in ${opener} and --mode ${requested} is wider; an agent you open runs in your mode or a narrower one`,
            modeLines(opener)
        );
    }
    return opener;
};

export const modeFlag = z.enum(MODE_ORDER, { error: `--mode is one of ${MODE_ORDER.join(', ')}` }).optional();
