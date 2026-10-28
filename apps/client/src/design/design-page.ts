import type { FsEntry } from '@ruimte/contracts';

/* What one page of a design may pull in from its folder, the bounds a visual's page keeps too. */
export const DESIGN_ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const DESIGN_PAGE_MAX_BYTES = 16 * 1024 * 1024;

/* The pages of a design: the HTML files right in its folder, by name, as the tabs above the stage show them. */
export function designFiles(entries: readonly FsEntry[]): string[] {
    return entries
        .filter((entry) => entry.kind === 'file' && /\.html?$/i.test(entry.name))
        .map((entry) => entry.name)
        .sort((one, other) => one.localeCompare(other, undefined, { numeric: true, sensitivity: 'base' }));
}

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

const STROKES_MARGIN = 24;

/* The box around every stroke of a drawing, with room around it, inside the layer it was drawn on. */
export function strokesBox(strokes: readonly (readonly Point[])[], size: { width: number; height: number }): Rect | null {
    const points = strokes.flat();

    if (points.length === 0) {
        return null;
    }

    const left = Math.max(0, Math.min(...points.map((point) => point.x)) - STROKES_MARGIN);
    const top = Math.max(0, Math.min(...points.map((point) => point.y)) - STROKES_MARGIN);
    const right = Math.min(size.width, Math.max(...points.map((point) => point.x)) + STROKES_MARGIN);
    const bottom = Math.min(size.height, Math.max(...points.map((point) => point.y)) + STROKES_MARGIN);

    return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/* A page as a person names it: its file without the extension. */
export function pageName(file: string): string {
    return file.replace(/\.html?$/i, '');
}

/* An address the frame loads as it is: the web, inline bytes, a fragment, or a path from the root nobody can mean as the folder's. */
function loadsAsItIs(reference: string): boolean {
    return /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(reference);
}

/*
 * The file a relative reference of a page names, relative to the design folder, or null when it leaves
 * the folder. The frame writes the page from a string, so a relative path loads nothing on its own.
 */
export function assetPathOf(reference: string): string | null {
    const path = reference.split(/[?#]/)[0]!;

    if (path === '' || loadsAsItIs(reference)) {
        return null;
    }

    const parts: string[] = [];

    for (const part of decodeURIComponent(path).split('/')) {
        if (part === '' || part === '.') {
            continue;
        }

        if (part === '..') {
            if (parts.length === 0) {
                return null;
            }

            parts.pop();
            continue;
        }

        parts.push(part);
    }

    return parts.length === 0 ? null : parts.join('/');
}

const ATTRIBUTE_REFERENCE = /\b(src|href|poster)\s*=\s*(["'])([^"']*)\2/gi;
const CSS_REFERENCE = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;

/* Every file of the folder a page pulls in through an attribute or a CSS `url()`, once each. */
export function assetReferences(html: string): string[] {
    const found = new Set<string>();

    for (const match of html.matchAll(ATTRIBUTE_REFERENCE)) {
        if (assetPathOf(match[3]!) !== null) {
            found.add(match[3]!);
        }
    }

    for (const match of html.matchAll(CSS_REFERENCE)) {
        if (assetPathOf(match[2]!) !== null) {
            found.add(match[2]!);
        }
    }

    return [...found];
}

/* The page with each reference it pulled in replaced by the bytes it names; a reference without bytes stays as it was. */
export function withAssets(html: string, inline: ReadonlyMap<string, string>): string {
    return html
        .replace(ATTRIBUTE_REFERENCE, (whole, name: string, quote: string, reference: string) => {
            const url = inline.get(reference);

            return url === undefined ? whole : `${name}=${quote}${url}${quote}`;
        })
        .replace(CSS_REFERENCE, (whole, quote: string, reference: string) => {
            const url = inline.get(reference);

            return url === undefined ? whole : `url(${quote}${url}${quote})`;
        });
}
