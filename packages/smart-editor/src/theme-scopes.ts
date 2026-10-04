import type { ScopeColors, ScopeStyle } from './types.ts';

/* The part of a TextMate theme's token colors this reads. */
export interface ThemeRule {
    readonly scope?: string | readonly string[];
    readonly settings: { readonly foreground?: string; readonly fontStyle?: string };
}

const FONT_STYLES: Record<string, number> = { italic: 1, bold: 2, underline: 4, strikethrough: 8 };

function fontStyleOf(text: string | undefined): number {
    return (text ?? '').split(/\s+/).reduce((flags, word) => flags | (FONT_STYLES[word] ?? 0), 0);
}

function nameMatches(selector: string, scope: string): boolean {
    return scope === selector || scope.startsWith(`${selector}.`);
}

/*
 * How well a selector fits a stack of scopes, outermost first, or null when it does not. As in a
 * TextMate theme the last word has to match the innermost scope and the words before it some outer
 * ones in order; the longer the name it matched, the better, and a selector with more words beats one
 * with fewer.
 */
function selectorScore(selector: string, stack: readonly string[]): number | null {
    const words = selector.trim().split(/\s+/);
    const last = words[words.length - 1]!;
    const innermost = stack[stack.length - 1];
    if (innermost === undefined || !nameMatches(last, innermost)) {
        return null;
    }
    let at = stack.length - 2;
    for (let word = words.length - 2; word >= 0; word--) {
        while (at >= 0 && !nameMatches(words[word]!, stack[at]!)) {
            at--;
        }
        if (at < 0) {
            return null;
        }
        at--;
    }
    return last.length * 100 + words.length;
}

/*
 * What a theme draws a scope stack in, the way its own grammar's tokens are colored: the rule that
 * fits best wins and a later rule beats an equal one. Undefined where no rule colors it, which is
 * where the editor keeps what the grammar said.
 */
export function scopeColorsOf(rules: readonly ThemeRule[]): ScopeColors {
    const flat = rules.flatMap((rule, order) =>
        (typeof rule.scope === 'string' ? rule.scope.split(',') : (rule.scope ?? [])).map((selector) => ({
            selector: selector.trim(),
            style: { color: rule.settings.foreground ?? '', fontStyle: fontStyleOf(rule.settings.fontStyle) },
            order
        }))
    );
    const cache = new Map<string, ScopeStyle | undefined>();
    return (stack) => {
        const key = stack.join(' ');
        if (cache.has(key)) {
            return cache.get(key);
        }
        let best: { score: number; order: number; style: ScopeStyle } | undefined;
        for (const entry of flat) {
            const score = entry.selector === '' ? null : selectorScore(entry.selector, stack);
            if (score !== null && (best === undefined || score > best.score || (score === best.score && entry.order > best.order))) {
                best = { score, order: entry.order, style: entry.style };
            }
        }
        const style = best !== undefined && best.style.color !== '' ? best.style : undefined;
        cache.set(key, style);
        return style;
    };
}
