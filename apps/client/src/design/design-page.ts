import { isPathBelow, type FsEntry } from '@ruimte/contracts';
import { TransportError } from '@/transport-api/transport';

/* What one read of a design folder came to: its entries, a folder that is not there yet, or a read that failed. */
export type DesignRead = { kind: 'listed'; entries: FsEntry[] } | { kind: 'missing' } | { kind: 'failed'; reason: string };

/*
 * What is known of a design folder: its entries, null while the folder is not there, and the reason the
 * last read failed. A failed read leaves the entries as they were, so a refresh that failed never turns
 * the pages shown into an empty design.
 */
export interface DesignListing {
    entries: FsEntry[] | null;
    problem: string | null;
}

/* The read a thrown error stands for. Only the code decides: `not-found` is a folder the chat has not made, anything else is a failure. */
export function designReadFailed(error: unknown): DesignRead {
    if (error instanceof TransportError && error.code === 'not-found') {
        return { kind: 'missing' };
    }

    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
}

/* The listing after a read of the folder. */
export function listingAfter(before: DesignListing, read: DesignRead): DesignListing {
    switch (read.kind) {
        case 'listed':
            return { entries: read.entries, problem: null };
        case 'missing':
            return { entries: null, problem: null };
        case 'failed':
            return { entries: before.entries, problem: read.reason };
    }
}

/* A listing and the machine and folder it was read from, so the pages kept through a failed read are only ever pages of the same folder. */
export interface ScopedListing {
    scope: string;
    listing: DesignListing;
}

export function designScope(endpointId: string, folder: string): string {
    return JSON.stringify([endpointId, folder]);
}

/* The listing of `scope`, none for a listing of another folder. */
export function listingOf(scoped: ScopedListing | null, scope: string): DesignListing | null {
    return scoped !== null && scoped.scope === scope ? scoped.listing : null;
}

/* The listing after a read of `scope`, which starts empty when the one before belongs to another folder. */
export function scopedListingAfter(before: ScopedListing | null, scope: string, read: DesignRead): ScopedListing {
    return { scope, listing: listingAfter(listingOf(before, scope) ?? { entries: null, problem: null }, read) };
}

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

/* The pages of a design the most recently changed first, the order its cards stand in on a canvas; a tie keeps the order of their names. */
export function pagesByChange(entries: readonly FsEntry[]): string[] {
    const changed = new Map(entries.map((entry) => [entry.name, entry.mtime]));
    return designFiles(entries).sort((one, other) => changed.get(other)! - changed.get(one)!);
}

/* When a page of the folder was last written, as the listing says; null for a page it does not hold. */
export function pageMtime(entries: readonly FsEntry[], file: string): number | null {
    return entries.find((entry) => entry.kind === 'file' && entry.name === file)?.mtime ?? null;
}

/*
 * Whether a change the machine reports touches a design folder. The machine names the folder of each
 * changed file, and every save of the project writes a file in a parent of a private design's folder, so
 * a parent counts only while the folder was not found yet: that is how the chat making it shows.
 */
export function changeReaches(changed: string, folder: string, found: boolean): boolean {
    return changed === folder || isPathBelow(folder, changed) || (!found && isPathBelow(changed, folder));
}

/*
 * The pages in the order their cards stand: the most recently changed first, but while one is open the
 * order it was read in holds, with a page that came since on top, so a write never moves the open card.
 */
export function arrangePages(before: readonly string[] | null, pages: readonly string[], frozen: boolean): string[] {
    if (!frozen || before === null) {
        return [...pages];
    }

    return [...pages.filter((page) => !before.includes(page)), ...before.filter((page) => pages.includes(page))];
}

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

const STROKES_MARGIN = 24;

/*
 * Where a pointer is on an element in its own layout pixels. A card on a zoomed canvas is scaled, so its
 * box on the screen is larger or smaller than the pixels its bitmap and the page lay out in.
 */
export function layoutPoint(
    client: Point,
    box: { left: number; top: number; width: number; height: number },
    layout: { width: number; height: number }
): Point {
    const scaleX = box.width > 0 ? layout.width / box.width : 1;
    const scaleY = box.height > 0 ? layout.height / box.height : 1;

    return { x: (client.x - box.left) * scaleX, y: (client.y - box.top) * scaleY };
}

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

/* A `%` that starts no escape, as in `100%.png`, stays as it is, the way a browser asks for such a path. */
function decodedPath(path: string): string {
    try {
        return decodeURIComponent(path);
    } catch {
        return path;
    }
}

/*
 * The file a relative reference of a page names, relative to the design folder, or null when it leaves
 * the folder. The frame writes the page from a string, so a relative path loads nothing on its own.
 * `from` is the folder of the page that makes the reference, inside the design folder.
 *
 * The rule is the same on every machine the path reaches, so a backslash separates like a slash (a
 * Windows machine reads `..\x` as a parent) and a drive, a UNC prefix, a NUL, or a separator or `..` that
 * only a percent escape spells out are refused after one decoding. A segment of nothing but dots and
 * spaces is refused too, which Windows reads as another name. The iPhone app and `RESOLVE_SCRIPT` hold
 * the same rule. Symlinks are out of scope: a page can read only what the client may read anyway, so
 * this keeps a page in its folder and is no sandbox against the person who opened it.
 */
export function assetPathOf(reference: string, from = ''): string | null {
    const path = reference.split(/[?#]/)[0]!;

    if (path === '' || loadsAsItIs(reference)) {
        return null;
    }

    const decoded = decodedPath(path);

    if (/\0|^[\\/]|^[a-z]:/i.test(decoded)) {
        return null;
    }

    const parts = from === '' ? [] : from.split('/');

    for (const part of decoded.split(/[\\/]/)) {
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

        if (/^[. ]+$/.test(part)) {
            return null;
        }

        parts.push(part);
    }

    return parts.length === 0 ? null : parts.join('/');
}

const ATTRIBUTE_REFERENCE = /\b(src|href|poster)\s*=\s*(["'])([^"']*)\2/gi;
const CSS_REFERENCE = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
const PAGE_URL_PREFIX = 'data:text/html;charset=utf-8,';

/* Every file of the folder a page in `from` pulls in through an attribute or a CSS `url()`, once each. */
export function assetReferences(html: string, from = ''): string[] {
    const found = new Set<string>();

    for (const match of html.matchAll(ATTRIBUTE_REFERENCE)) {
        if (assetPathOf(match[3]!, from) !== null) {
            found.add(match[3]!);
        }
    }

    for (const match of html.matchAll(CSS_REFERENCE)) {
        if (assetPathOf(match[2]!, from) !== null) {
            found.add(match[2]!);
        }
    }

    return [...found];
}

/* How many bytes a page being built may still grow by: what it weighs counts every place a file or page stands in it, however often. */
export interface Room {
    left: number;
}

/* Takes `bytes` from the room, or none when they do not fit. */
export function takeRoom(room: Room, bytes: number): boolean {
    if (bytes > room.left) {
        return false;
    }

    room.left -= bytes;

    return true;
}

const ENCODER = new TextEncoder();

/* What text weighs as the bytes of a page. */
export function byteLength(text: string): number {
    return ENCODER.encode(text).length;
}

/*
 * The page with each reference it pulled in replaced by the bytes it names; a reference without bytes stays as it was.
 * A link to another page keeps its path: no browser opens an inline page from a link, so the copy would only weigh.
 * A file named in many places is in every one of them, so each place takes what it adds from `room`, and one that
 * does not fit stays the path it was.
 */
export function withAssets(html: string, inline: ReadonlyMap<string, string>, room?: Room): string {
    const weights = new Map<string, number>();
    const grows = (reference: string, url: string): boolean => {
        if (room === undefined) {
            return true;
        }

        for (const text of [reference, url]) {
            if (!weights.has(text)) {
                weights.set(text, byteLength(text));
            }
        }

        return takeRoom(room, Math.max(0, weights.get(url)! - weights.get(reference)!));
    };

    return html
        .replace(ATTRIBUTE_REFERENCE, (whole, name: string, quote: string, reference: string) => {
            const url = inline.get(reference);

            if (url === undefined || (name.toLowerCase() === 'href' && url.startsWith(PAGE_URL_PREFIX)) || !grows(reference, url)) {
                return whole;
            }

            return `${name}=${quote}${url}${quote}`;
        })
        .replace(CSS_REFERENCE, (whole, quote: string, reference: string) => {
            const url = inline.get(reference);

            return url === undefined || !grows(reference, url) ? whole : `url(${quote}${url}${quote})`;
        });
}

/* Whether a file of the folder is a page, which a page frames as a page of its own rather than as bytes. */
export function isPagePath(path: string): boolean {
    return /\.html?$/i.test(path);
}

/* A character a file name may hold in a page's text: one of `[\w%./-]`. */
function isNameChar(code: number): boolean {
    return isWordChar(code) || code === 37 || code === 46 || code === 47 || code === 45;
}

/* A character of `\w`. */
function isWordChar(code: number): boolean {
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

/* Whether the characters at `at` spell `letters` (lowercase) in either case. */
function spells(html: string, at: number, letters: string): boolean {
    for (let i = 0; i < letters.length; i++) {
        if ((html.charCodeAt(at + i) | 0x20) !== letters.charCodeAt(i)) {
            return false;
        }
    }

    return true;
}

/* Whether a name may end at `end`: what follows goes on neither as a word, a dash, nor a dot and a word. */
function endsName(html: string, end: number): boolean {
    const next = html.charCodeAt(end);

    if (Number.isNaN(next)) {
        return true;
    }

    if (isWordChar(next) || next === 45) {
        return false;
    }

    return !(next === 46 && isWordChar(html.charCodeAt(end + 1)));
}

/*
 * The page a run of name characters, `html[start..end]`, names: the run up to its last `.htm` or `.html`
 * that ends on its own, after at least one character. No other can follow it in the run, since that one
 * would have been the last.
 */
function pageNamedIn(html: string, start: number, end: number): string | null {
    for (let at = end; at >= start + 5; at--) {
        const dot =
            html.charCodeAt(at - 5) === 46 && spells(html, at - 4, 'html')
                ? at - 5
                : html.charCodeAt(at - 4) === 46 && spells(html, at - 3, 'htm')
                  ? at - 4
                  : -1;

        if (dot > start && endsName(html, at)) {
            return html.slice(start, at);
        }
    }

    return null;
}

/*
 * Every page a page names anywhere, in an attribute or inside its own script, once each: a script that
 * builds `page.html?theme=dark` to frame it names the page only as text. Found by walking each run of
 * name characters once, back from its end; a pattern that retries from every character of a long run
 * takes time in the square of its length.
 */
export function pageMentions(html: string): string[] {
    const found = new Set<string>();
    let at = 0;

    while (at < html.length) {
        if (!isNameChar(html.charCodeAt(at))) {
            at++;
            continue;
        }

        let end = at + 1;

        while (end < html.length && isNameChar(html.charCodeAt(end))) {
            end++;
        }

        const page = pageNamedIn(html, at, end);

        if (page !== null) {
            found.add(page);
        }

        at = end;
    }

    return [...found];
}

/*
 * A page standing on its own as an address a frame loads. Percent-encoded rather than base64, so a query
 * after it reaches the page's `location.search` (a base64 body refuses one), and closed by an open
 * comment, since the browser reads that query as the end of the page too. Only what the address would
 * otherwise cut, drop or end, and what would end the attribute it stands in, is escaped.
 */
export function pageDataUrl(html: string): string {
    const escaped = `${html}<!--`.replace(/[%#?\t\n\r "'&<>()\\]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);

    return `${PAGE_URL_PREFIX}${escaped}`;
}

/* `assetPathOf` for the scripts that run in a page, which take no module. */
export const RESOLVE_SCRIPT = String.raw`function resolved(text, from) {
        var cut = text.search(/[?#]/);
        var path = cut === -1 ? text : text.slice(0, cut);
        if (path === '' || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(text)) { return null; }
        try { path = decodeURIComponent(path); } catch (e) {}
        if (/\0|^[\\\/]|^[a-z]:/i.test(path)) { return null; }
        var parts = from === '' ? [] : from.split('/');
        var inside = path.split(/[\\\/]/).every(function (part) {
            if (part === '' || part === '.') { return true; }
            if (part === '..') { return parts.pop() !== undefined; }
            if (/^[. ]+$/.test(part)) { return false; }
            parts.push(part);
            return true;
        });
        return inside && parts.length > 0 ? parts.join('/') : null;
    }`;

/*
 * What runs first in a page that frames pages of its folder: a frame whose script sets its address to one
 * of them gets that page standing on its own, with the query and fragment it was given. Otherwise the
 * address would stand beside the sandbox's host page, which the frame may not load. It takes its two
 * values as the JSON they stand in, so the iPhone app can carry the text of the script and fill them in.
 */
export function framedPagesScript(pagesJson: string, fromJson: string): string {
    return String.raw`(function () {
    var pages = ${pagesJson}, from = ${fromJson};
    ${RESOLVE_SCRIPT}
    function framed(value) {
        var text = String(value), cut = text.search(/[?#]/);
        var key = resolved(text, from);
        if (key === null || !Object.prototype.hasOwnProperty.call(pages, key)) { return value; }
        return pages[key] + (cut === -1 ? '' : text.slice(cut));
    }
    var src = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', { configurable: true, enumerable: src.enumerable, get: src.get, set: function (value) { src.set.call(this, framed(value)); } });
    var setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
        return setAttribute.call(this, name, this instanceof HTMLIFrameElement && String(name).toLowerCase() === 'src' ? framed(value) : value);
    };
})();`;
}

/* JSON that a `<script>` holds as it is: nothing in it ends the element or opens a comment. */
export function inlineJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

/* The script that frames pages of its folder, as it stands in a page; `pagesJson` is the pages it frames by their path. */
export function framedPagesElement(pagesJson: string, from: string): string {
    return `<script data-ruimte-pages>${framedPagesScript(pagesJson, inlineJson(from))}</script>`;
}

/* The page with the script that frames pages of its folder at the start of its head, before any script of its own runs. */
export function withFramedPages(html: string, from: string, pages: ReadonlyMap<string, string>): string {
    if (pages.size === 0) {
        return html;
    }

    return atHeadStart(html, framedPagesElement(inlineJson(Object.fromEntries(pages)), from));
}

/* The page with `element` first in its head, before any script of its own runs. */
export function atHeadStart(html: string, element: string): string {
    const opening = /<head(?:\s[^>]*)?>/i.exec(html) ?? /<html(?:\s[^>]*)?>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html);
    const at = opening === null ? 0 : opening.index + opening[0].length;

    return `${html.slice(0, at)}${element}${html.slice(at)}`;
}
