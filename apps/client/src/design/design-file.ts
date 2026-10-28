import type { TweakValue } from '@/design/design-protocol';

/* Per selector, the properties a person set with Edit, as CSS property names. */
export type DesignEdits = Record<string, Record<string, string>>;

const EDITS_BLOCK = /<style id="ruimte-edits">([\s\S]*?)<\/style>/i;
const TWEAKS_BLOCK = /(<script type="application\/json" id="ruimte-tweaks">)([\s\S]*?)(<\/script>)/i;

/* The rules of the overrides block of a page, read back the way `withEdits` writes them. */
export function editsOf(html: string): DesignEdits {
    const block = EDITS_BLOCK.exec(html)?.[1] ?? '';
    const edits: DesignEdits = {};

    for (const rule of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1]!.trim();
        const declarations: Record<string, string> = {};

        for (const declaration of rule[2]!.split(';')) {
            const at = declaration.indexOf(':');

            if (at > 0) {
                declarations[declaration.slice(0, at).trim()] = declaration
                    .slice(at + 1)
                    .replace(/!important/i, '')
                    .trim();
            }
        }

        if (selector !== '' && Object.keys(declarations).length > 0) {
            edits[selector] = { ...edits[selector], ...declarations };
        }
    }

    return edits;
}

/* The block as CSS, each property `!important` so it wins over the inline styles of the page. */
export function editsCss(edits: DesignEdits): string {
    return Object.entries(edits)
        .filter(([, declarations]) => Object.keys(declarations).length > 0)
        .map(
            ([selector, declarations]) =>
                `${selector} { ${Object.entries(declarations)
                    .map(([property, value]) => `${property}: ${value} !important;`)
                    .join(' ')} }`
        )
        .join('\n');
}

/*
 * The page with these edits in its overrides block, merged over what the block held. The block sits at
 * the end of the head, or of the page when it has none, and is the only part of the file this touches.
 */
export function withEdits(html: string, edits: DesignEdits): string {
    const merged = { ...editsOf(html) };

    for (const [selector, declarations] of Object.entries(edits)) {
        merged[selector] = { ...merged[selector], ...declarations };
    }

    const block = `<style id="ruimte-edits">\n${editsCss(merged)}\n</style>`;

    if (EDITS_BLOCK.test(html)) {
        return html.replace(EDITS_BLOCK, () => block);
    }

    const head = html.search(/<\/head\s*>/i);

    return head === -1 ? `${html}\n${block}` : `${html.slice(0, head)}${block}\n${html.slice(head)}`;
}

/* The page with the values of its tweaks written into their declaration, every other key of it as it was; null when the page declares none. */
export function withTweakValues(html: string, values: Readonly<Record<string, TweakValue>>): string | null {
    const match = TWEAKS_BLOCK.exec(html);

    if (match === null) {
        return null;
    }

    let declared: Record<string, Record<string, unknown>>;

    try {
        declared = JSON.parse(match[2]!);
    } catch {
        return null;
    }

    for (const [name, value] of Object.entries(values)) {
        if (declared[name] !== undefined) {
            declared[name] = { ...declared[name], value };
        }
    }

    return html.replace(TWEAKS_BLOCK, (_whole, open: string, _body: string, close: string) => `${open}${JSON.stringify(declared, null, 4)}${close}`);
}
