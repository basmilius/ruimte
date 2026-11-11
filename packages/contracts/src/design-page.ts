import { blobTypeFor } from './bytes.ts';

/* What one page of a design may pull in from its folder, the bounds a visual's page keeps too. */
export const DESIGN_ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const DESIGN_PAGE_MAX_BYTES = 16 * 1024 * 1024;

/* The method between a design page and the window it is framed in for a file its script names while it runs. */
export const DESIGN_ASSET_METHOD = 'ruimte/design/asset';

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

export function takeRoom(room: Room, bytes: number): boolean {
    if (bytes > room.left) {
        return false;
    }

    room.left -= bytes;

    return true;
}

const ENCODER = new TextEncoder();

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

/*
 * The type a file of the folder carries in its `data:` URL. A stylesheet and a script keep theirs: the
 * sandbox frame refuses a stylesheet typed as a download, and a page of a design is meant to run its own.
 * Every other file is typed as a URL on a client's origin would be.
 */
export function designAssetType(path: string, mime: string): string {
    if (/\.css$/i.test(path)) {
        return 'text/css';
    }

    if (/\.m?js$/i.test(path)) {
        return 'text/javascript';
    }

    return blobTypeFor(mime);
}

/* Whether a file of the folder is a page, which a page frames as a page of its own rather than as bytes. */
export function isPagePath(path: string): boolean {
    return /\.html?$/i.test(path);
}

/* A character a file name may hold in a page's text: one of `[\w%./-]`. */
function isNameChar(code: number): boolean {
    return isWordChar(code) || code === 37 || code === 46 || code === 47 || code === 45;
}

function isWordChar(code: number): boolean {
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

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

export function atHeadStart(html: string, element: string): string {
    const opening = /<head(?:\s[^>]*)?>/i.exec(html) ?? /<html(?:\s[^>]*)?>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html);
    const at = opening === null ? 0 : opening.index + opening[0].length;

    return `${html.slice(0, at)}${element}${html.slice(at)}`;
}

/*
 * What runs first in a page with a script: a file of the folder the script names while it runs, in an
 * attribute or in markup it adds, is asked of the window the page is framed in and shown from its bytes,
 * since the page is written from a string and a relative path loads nothing. The stage answers the page
 * it shows; a page answers the pages it frames from what it was answered itself, so a page framed in a
 * page reaches the stage without carrying the folder along. A page on its own, as Export hands it out,
 * asks nobody and leaves its paths as they are. The iPhone app shows a page as the document of its web
 * view, with no window above it, so its page asks `window.ruimteHost.asset(path)`, which answers with the
 * bytes or null, in the stage's place. It takes `from` as the JSON it stands in, so the app can carry the
 * text of the script and fill it in.
 */
export function runtimeAssetsScript(fromJson: string): string {
    return String.raw`(function () {
    var host = window.ruimteHost;
    if (window.parent === window && !host) { return; }
    var method = ${inlineJson(DESIGN_ASSET_METHOD)}, from = ${fromJson};
    var waiting = {}, asked = {}, urls = {};
    ${RESOLVE_SCRIPT}
    function pathOf(reference) {
        var path = resolved(String(reference).trim(), from);
        return path === null || /\.html?$/i.test(path) ? null : path;
    }
    function bytesOf(path) {
        if (!asked[path]) {
            if (host) {
                asked[path] = host.asset(path);
            } else {
                asked[path] = new Promise(function (resolve) { waiting[path] = resolve; });
                window.parent.postMessage({ jsonrpc: '2.0', method: method, params: { path: path } }, '*');
            }
        }
        return asked[path];
    }
    function urlOf(path) {
        if (!urls[path]) {
            urls[path] = bytesOf(path).then(function (bytes) { return bytes === null ? null : URL.createObjectURL(bytes); });
        }
        return urls[path];
    }
    function framedHere(source) {
        for (var i = 0; i < window.frames.length; i++) { if (window.frames[i] === source) { return true; } }
        return false;
    }
    addEventListener('message', function (event) {
        var data = event.data, params = data && data.params;
        if (!data || data.jsonrpc !== '2.0' || data.method !== method || !params || typeof params.path !== 'string') { return; }
        if (window.parent !== window && event.source === window.parent) {
            if (waiting[params.path]) { waiting[params.path](params.bytes instanceof Blob ? params.bytes : null); delete waiting[params.path]; }
            return;
        }
        // Only a page this one frames from bytes of its own: a page of the web it frames gets nothing of the folder.
        if (event.origin !== 'null' || !framedHere(event.source) || params.path.length > 1024) { return; }
        var source = event.source;
        bytesOf(params.path).then(function (bytes) { source.postMessage({ jsonrpc: '2.0', method: method, params: { path: params.path, bytes: bytes } }, '*'); });
    });
    var URL_REFERENCE = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
    function referencesIn(name, value) {
        if (name === 'style') {
            var found = [];
            value.replace(URL_REFERENCE, function (whole, quote, reference) { found.push(reference); return whole; });
            return found;
        }
        if (name === 'srcset') {
            // A data address holds commas of its own, so a set with one is left as it is.
            return /data:/i.test(value) ? [] : value.split(',').map(function (candidate) { return candidate.trim().split(/\s+/)[0]; });
        }
        return [value];
    }
    function swapped(name, value, found) {
        if (name === 'style') {
            return value.replace(URL_REFERENCE, function (whole, quote, reference) { return found[reference] ? 'url(' + quote + found[reference] + quote + ')' : whole; });
        }
        if (name === 'srcset') {
            return value.split(',').map(function (candidate) {
                var parts = candidate.trim().split(/\s+/);
                if (found[parts[0]]) { parts[0] = found[parts[0]]; }
                return parts.join(' ');
            }).join(', ');
        }
        return found[value] || value;
    }
    function applies(element, name) {
        var tag = element.localName;
        if (name === 'style') { return true; }
        if (name === 'srcset') { return tag === 'img' || tag === 'source'; }
        if (name === 'poster') { return tag === 'video'; }
        return /^(?:img|source|video|audio|track|input)$/.test(tag);
    }
    function rewrite(element, name) {
        var value = element.getAttribute(name);
        if (value === null || !applies(element, name)) { return; }
        var references = referencesIn(name, value).filter(function (reference) { return pathOf(reference) !== null; });
        if (references.length === 0) { return; }
        Promise.all(references.map(function (reference) { return urlOf(pathOf(reference)); })).then(function (loaded) {
            if (element.getAttribute(name) !== value) { return; }
            var found = {};
            references.forEach(function (reference, index) {
                var hash = reference.trim().indexOf('#');
                if (loaded[index] !== null) { found[reference] = loaded[index] + (hash === -1 ? '' : reference.trim().slice(hash)); }
            });
            var next = swapped(name, value, found);
            if (next !== value) { element.setAttribute(name, next); }
        });
    }
    var NAMES = ['src', 'srcset', 'poster', 'style'];
    function visit(node) {
        if (node.nodeType !== 1) { return; }
        NAMES.forEach(function (name) { rewrite(node, name); });
        node.querySelectorAll('[src], [srcset], [poster], [style]').forEach(function (element) {
            NAMES.forEach(function (name) { rewrite(element, name); });
        });
    }
    new MutationObserver(function (records) {
        records.forEach(function (record) {
            if (record.type === 'attributes') { rewrite(record.target, record.attributeName); } else { record.addedNodes.forEach(visit); }
        });
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: NAMES });
})();`;
}

export function runtimeAssetsElement(from: string): string {
    return `<script data-ruimte-assets>${runtimeAssetsScript(inlineJson(from))}</script>`;
}

export function withRuntimeAssets(html: string, from: string): string {
    return atHeadStart(html, runtimeAssetsElement(from));
}
