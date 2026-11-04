import type { FindQuery } from '@adecore/editor-react/models';
import type { ISearchOptions } from '@xterm/addon-search';

type TerminalFindColors = NonNullable<ISearchOptions['decorations']>;

interface Rgba {
    red: number;
    green: number;
    blue: number;
    alpha: number;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+)(%?))?\s*\)$/i;

/* The two forms the theme tokens are written in; anything else reads as nothing, which the mix leaves to the background. */
function parseColor(value: string): Rgba | null {
    const text = value.trim();
    const hex = HEX.exec(text)?.[1];
    if (hex !== undefined) {
        const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex;
        const alpha = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
        return { red: parseInt(full.slice(0, 2), 16), green: parseInt(full.slice(2, 4), 16), blue: parseInt(full.slice(4, 6), 16), alpha };
    }
    const match = FUNCTION.exec(text);
    if (match === null) {
        return null;
    }
    const alpha = match[4] === undefined ? 1 : match[5] === '%' ? Number(match[4]) / 100 : Number(match[4]);
    return { red: Number(match[1]), green: Number(match[2]), blue: Number(match[3]), alpha: Math.min(1, Math.max(0, alpha)) };
}

function channel(value: number): string {
    return Math.round(Math.min(255, Math.max(0, value)))
        .toString(16)
        .padStart(2, '0');
}

/* `color` over `ground` as an opaque #RRGGBB, since the search addon takes no other format; `strength` scales the color's own alpha. */
function mixOver(color: string, ground: Rgba, strength = 1): string {
    const top = parseColor(color);
    if (top === null) {
        return `#${channel(ground.red)}${channel(ground.green)}${channel(ground.blue)}`;
    }
    const alpha = top.alpha * strength;
    const mixed = (above: number, below: number): string => channel(above * alpha + below * (1 - alpha));
    return `#${mixed(top.red, ground.red)}${mixed(top.green, ground.green)}${mixed(top.blue, ground.blue)}`;
}

/*
 * The decorations in the find tokens: a match is `--find-match` over the terminal's ground, the active one
 * is edged in `--find-current` with half of it behind the text, so `--term-fg` stays readable on it.
 */
export function terminalFindColors(style: CSSStyleDeclaration): TerminalFindColors {
    const ground = parseColor(style.getPropertyValue('--term-bg')) ?? { red: 0, green: 0, blue: 0, alpha: 1 };
    const match = style.getPropertyValue('--find-match');
    const current = style.getPropertyValue('--find-current');
    return {
        matchBackground: mixOver(match, ground),
        matchOverviewRuler: mixOver(current, ground),
        activeMatchBackground: mixOver(current, ground, 0.5),
        activeMatchBorder: mixOver(current, ground),
        activeMatchColorOverviewRuler: mixOver(current, ground)
    };
}

/* A step goes to the next match; typing refines the one under the cursor, which the caller asks for with `incremental`. */
export function searchOptionsOf(query: FindQuery, colors: TerminalFindColors): ISearchOptions {
    return { caseSensitive: query.caseSensitive, wholeWord: query.wholeWord, regex: query.regex, incremental: false, decorations: colors };
}

export interface TerminalFindResult {
    total: number;
    /* Zero-based; null while no match is the current one. */
    current: number | null;
    /* More matches than the addon highlights, so the count is a floor. */
    limited: boolean;
}

/* The addon stops counting at its highlight limit, so a count that reaches it is a floor. It reports -1 for the index when no match is current, and the bar wants null there. */
export function findResultOf(event: { resultIndex: number; resultCount: number }, limit: number): TerminalFindResult {
    return {
        total: event.resultCount,
        current: event.resultIndex < 0 ? null : event.resultIndex,
        limited: event.resultCount >= limit
    };
}
