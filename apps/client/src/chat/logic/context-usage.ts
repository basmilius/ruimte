import type { ChatContextBreakdown, ChatUsage, ModelOptionDescriptor } from '@ruimte/contracts';

export const CONTEXT_OPTION = 'contextWindow';

export type ContextPart = keyof ChatContextBreakdown;

export const CONTEXT_PARTS: readonly ContextPart[] = ['toolOutput', 'filesRead', 'conversation', 'system'];

export interface ContextSegment {
    part: ContextPart;
    tokens: number;
    /* Of the window, so the segments together fill the bar as far as the context is full. */
    fraction: number;
}

export const contextFraction = (usage: ChatUsage): number => (usage.contextWindow ? Math.min(1, usage.contextTokens / usage.contextWindow) : 0);

/* The stretches of the bar, in the legend's order; null from a daemon that does not estimate, which draws the plain bar. */
export const contextSegments = (usage: ChatUsage): ContextSegment[] | null => {
    const breakdown = usage.breakdown;
    if (!breakdown || usage.contextTokens === 0) {
        return null;
    }
    const whole = Math.max(usage.contextWindow ?? 0, usage.contextTokens);
    return CONTEXT_PARTS.map((part) => ({ part, tokens: breakdown[part], fraction: breakdown[part] / whole }));
};

/*
 * The model's own knobs with the context window last: its details sit in the group right under it,
 * and a switch like Fast mode belongs with the reasoning choice above rather than below the size.
 */
export const orderOptions = (options: readonly ModelOptionDescriptor[]): ModelOptionDescriptor[] => [
    ...options.filter((option) => option.id !== CONTEXT_OPTION),
    ...options.filter((option) => option.id === CONTEXT_OPTION)
];
