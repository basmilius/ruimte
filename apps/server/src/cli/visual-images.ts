import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { VISUAL_LIMITS } from '@ruimte/contracts';
import { field } from '@adecore/agents/context/refusal';

/*
 * A visual's page may name a local image by its absolute path, and the CLI puts that image in the page
 * as a data: URI before the page leaves, so it shows on every client and outlives the file. This runs
 * in the agent's own process, inside whatever sandbox its CLI gives it: the daemon never reads a path
 * an agent names, since that would hand the agent what its own sandbox withholds.
 */

const MIB = 1024 * 1024;

/* The most one image may take on disk. */
export const VISUAL_IMAGE_BYTES = 10 * MIB;

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico']);

// PATH_MAX on Linux: nothing longer is a path a file system opens, and it bounds the scan from one quote.
const PATH_CHARS = 4096;

// `data:` and `;base64,` around the shortest type the bytes can give (image/png, image/gif, image/bmp).
const SHORTEST_PREFIX = 'data:image/png;base64,'.length;

const SLASH = 0x2f;
const BACKSLASH = 0x5c;
const COLON = 0x3a;
const DOLLAR = 0x24;
const OPEN_BRACE = 0x7b;
const OPEN_PAREN = 0x28;
const CLOSE_PAREN = 0x29;
const DOUBLE_QUOTE = 0x22;
const SINGLE_QUOTE = 0x27;
const BACKTICK = 0x60;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

const HELP_LINE = 'detail\truimte-context help visual';

export interface ImageReference {
    /* The path as the page writes it, without its quotes or `url(`. */
    readonly start: number;
    readonly end: number;
    /* The file to read: the path as written, with the doubled backslashes of a JS string undone. */
    readonly path: string;
}

export interface ImageProblem {
    readonly path: string;
    readonly kind: 'missing' | 'too-large';
    readonly reason: string;
}

export interface EmbeddedPage {
    /* The page with every image that could be embedded in place, and the rest as written. */
    readonly html: string;
    /* One per path that is not embedded, in the order the page first names them. */
    readonly problems: readonly ImageProblem[];
    /* At least the bytes the page would take with its images, when a whole embed stopped because they cannot fit. */
    readonly overflow: number | null;
}

export interface ImageFiles {
    /* The size of the regular file at a path; throws as the file system does when there is none. */
    size(path: string): Promise<number>;
    /* Reads the regular file at a path into `into` until it is full or the file ends, and answers the bytes read. */
    read(path: string, into: Buffer): Promise<number>;
}

export interface EmbedOptions {
    /* Embed what fits and leave the rest as written, rather than stop as soon as the page cannot hold them all. */
    readonly partial: boolean;
    readonly imageBytes?: number;
    readonly pageBytes?: number;
    readonly files?: ImageFiles;
}

export type PreparedPage =
    | { readonly argv: string[]; readonly lines: string[] }
    | { readonly refusal: { readonly code: string; readonly message: string; readonly lines: string[] } };

/* A directory, a device or a pipe under an image's name. */
class NotAFile extends Error {}

function isSpace(code: number): boolean {
    return code === 0x20 || code === 0x09 || code === LINE_FEED || code === 0x0c || code === CARRIAGE_RETURN;
}

function isLetter(code: number): boolean {
    return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isNameChar(code: number): boolean {
    return isLetter(code) || (code >= 0x30 && code <= 0x39) || code === 0x2d || code === 0x5f;
}

/* `/x` but not `//host`, or a drive: `C:\` or `C:/`. */
function startsPath(html: string, at: number): boolean {
    const first = html.charCodeAt(at);
    if (first === SLASH) {
        return html.charCodeAt(at + 1) !== SLASH;
    }
    const separator = html.charCodeAt(at + 2);
    return isLetter(first) && html.charCodeAt(at + 1) === COLON && (separator === SLASH || separator === BACKSLASH);
}

function hasImageExtension(path: string): boolean {
    const dot = path.lastIndexOf('.');
    return dot !== -1 && IMAGE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/* A drive path in a JS string doubles every backslash; the file system knows one. */
function pathOnDisk(written: string): string {
    return written.charCodeAt(1) === COLON && written.startsWith('\\\\', 2) ? written.replaceAll('\\\\', '\\') : written;
}

interface Match {
    readonly reference: ImageReference;
    /* Where the scan goes on: past the closing quote or parenthesis. */
    readonly next: number;
}

function matchAt(html: string, start: number, end: number, next: number): Match | null {
    const written = html.slice(start, end);
    return hasImageExtension(written) ? { reference: { start, end, path: pathOnDisk(written) }, next } : null;
}

/*
 * The whole of the string that opens at a quote. Its scan ends at the next quote of the same kind, a
 * line break or the length of a path, so the scans from one kind of quote never overlap and the page
 * is read a bounded number of times however many quotes it holds.
 */
function quotedAt(html: string, open: number): Match | null {
    const quote = html.charCodeAt(open);
    const start = open + 1;
    if (!startsPath(html, start)) {
        return null;
    }
    const last = Math.min(html.length, start + PATH_CHARS + 1);
    for (let i = start; i < last; i++) {
        const code = html.charCodeAt(i);
        if (code === quote) {
            return matchAt(html, start, i, i + 1);
        }
        if (code === LINE_FEED || code === CARRIAGE_RETURN || (quote === BACKTICK && code === DOLLAR && html.charCodeAt(i + 1) === OPEN_BRACE)) {
            return null;
        }
    }
    return null;
}

function opensUrl(html: string, paren: number): boolean {
    return paren >= 3 && html.slice(paren - 3, paren).toLowerCase() === 'url' && !isNameChar(html.charCodeAt(paren - 4));
}

function endsBareUrl(code: number): boolean {
    return code === CLOSE_PAREN || code === OPEN_PAREN || code === DOUBLE_QUOTE || code === SINGLE_QUOTE || code === BACKTICK || isSpace(code);
}

/* The bare argument of a CSS `url(`; a quoted one is a string like any other. Its scan stops at the next parenthesis. */
function bareUrlAt(html: string, paren: number): Match | null {
    if (!opensUrl(html, paren)) {
        return null;
    }
    let start = paren + 1;
    while (start < html.length && isSpace(html.charCodeAt(start))) {
        start++;
    }
    if (!startsPath(html, start)) {
        return null;
    }
    const last = Math.min(html.length, start + PATH_CHARS);
    let end = start;
    while (end < last && !endsBareUrl(html.charCodeAt(end))) {
        end++;
    }
    let close = end;
    while (close < html.length && isSpace(html.charCodeAt(close))) {
        close++;
    }
    return html.charCodeAt(close) === CLOSE_PAREN ? matchAt(html, start, end, close + 1) : null;
}

/*
 * The local images a page names: an absolute path ending in an image extension that is the whole of a
 * quoted string, a template literal without `${`, or the bare argument of a CSS `url()`. One pass
 * without a regular expression, so a large page never makes it backtrack.
 */
export function findImageReferences(html: string): ImageReference[] {
    const found: ImageReference[] = [];
    let i = 0;
    while (i < html.length) {
        const code = html.charCodeAt(i);
        const match = code === DOUBLE_QUOTE || code === SINGLE_QUOTE || code === BACKTICK ? quotedAt(html, i) : code === OPEN_PAREN ? bareUrlAt(html, i) : null;
        if (match === null) {
            i++;
            continue;
        }
        found.push(match.reference);
        i = match.next;
    }
    return found;
}

function viewOf(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function hasText(bytes: Uint8Array, at: number, text: string): boolean {
    if (bytes.length < at + text.length) {
        return false;
    }
    for (let i = 0; i < text.length; i++) {
        if (bytes[at + i] !== text.charCodeAt(i)) {
            return false;
        }
    }
    return true;
}

const PNG_SIGNATURE = '\x89PNG\r\n\x1a\n';
const WEBP_CHUNKS = ['VP8 ', 'VP8L', 'VP8X'];
const AVIF_BRANDS: ReadonlySet<string> = new Set(['avif', 'avis']);
const HEIC_BRANDS: ReadonlySet<string> = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs']);
const HEIF_BRANDS: ReadonlySet<string> = new Set(['mif1', 'msf1']);
// The sizes of the headers a BMP's file header may be followed by, from the OS/2 one to version 5.
const BMP_HEADERS: ReadonlySet<number> = new Set([12, 16, 40, 52, 56, 64, 108, 124]);

/* An ISO media file is an image only when one of its `ftyp` brands says so; a video has the same box. */
function heifType(bytes: Uint8Array): string | null {
    if (!hasText(bytes, 4, 'ftyp')) {
        return null;
    }
    const size = viewOf(bytes).getUint32(0);
    if (size < 16 || size > bytes.length || size % 4 !== 0) {
        return null;
    }
    // The major brand, then the compatible ones after the minor version.
    const brands = [String.fromCharCode(...bytes.subarray(8, 12))];
    for (let at = 16; at < size; at += 4) {
        brands.push(String.fromCharCode(...bytes.subarray(at, at + 4)));
    }
    if (brands.some((brand) => AVIF_BRANDS.has(brand))) {
        return 'image/avif';
    }
    if (brands.some((brand) => HEIC_BRANDS.has(brand))) {
        return 'image/heic';
    }
    return brands.some((brand) => HEIF_BRANDS.has(brand)) ? 'image/heif' : null;
}

function isBmp(bytes: Uint8Array): boolean {
    if (bytes.length < 26 || !hasText(bytes, 0, 'BM')) {
        return false;
    }
    const view = viewOf(bytes);
    const header = view.getUint32(14, true);
    const pixels = view.getUint32(10, true);
    return BMP_HEADERS.has(header) && pixels >= 14 + header && pixels <= bytes.length;
}

function isIco(bytes: Uint8Array): boolean {
    if (bytes.length < 6 || bytes[0] !== 0 || bytes[1] !== 0 || bytes[2] !== 1 || bytes[3] !== 0) {
        return false;
    }
    const view = viewOf(bytes);
    const count = view.getUint16(4, true);
    const directory = 6 + 16 * count;
    if (count === 0 || directory > bytes.length) {
        return false;
    }
    for (let at = 6; at < directory; at += 16) {
        const size = view.getUint32(at + 8, true);
        const offset = view.getUint32(at + 12, true);
        if (bytes[at + 3] !== 0 || offset < directory || offset + size > bytes.length) {
            return false;
        }
    }
    return true;
}

function skipSpace(text: string, from: number): number {
    let at = from;
    while (at < text.length && isSpace(text.charCodeAt(at))) {
        at++;
    }
    return at;
}

/* Just past the next `close` from `from`, or -1 when the text ends first. */
function pastNext(text: string, close: string, from: number): number {
    const found = text.indexOf(close, from);
    return found === -1 ? -1 : found + close.length;
}

/* Just past the `>` that ends a doctype, whose internal subset may hold a `>` in a literal, a comment or an instruction. */
function pastDoctype(text: string, from: number): number {
    let subset = false;
    let at = from;
    while (at !== -1 && at < text.length) {
        const char = text[at];
        if (char === '"' || char === "'") {
            at = pastNext(text, char, at + 1);
        } else if (subset && text.startsWith('<!--', at)) {
            at = pastNext(text, '-->', at + 4);
        } else if (subset && text.startsWith('<?', at)) {
            at = pastNext(text, '?>', at + 2);
        } else if (char === '>' && !subset) {
            return at + 1;
        } else {
            if (char === '[' || char === ']') {
                subset = char === '[';
            }
            at++;
        }
    }
    return -1;
}

/* An SVG is a document whose root element is `<svg>`: past an XML declaration, instructions, comments and a doctype, in one forward pass. */
function isSvg(bytes: Uint8Array): boolean {
    const text = new TextDecoder().decode(bytes);
    let at = skipSpace(text, 0);
    for (;;) {
        let next: number;
        if (text.startsWith('<?', at)) {
            next = pastNext(text, '?>', at + 2);
        } else if (text.startsWith('<!--', at)) {
            next = pastNext(text, '-->', at + 4);
        } else if (text.startsWith('<!DOCTYPE', at)) {
            next = pastDoctype(text, at + '<!DOCTYPE'.length);
        } else {
            break;
        }
        if (next === -1) {
            return false;
        }
        at = skipSpace(text, next);
    }
    const after = text.charCodeAt(at + 4);
    return text.startsWith('<svg', at) && (isSpace(after) || after === SLASH || after === 0x3e);
}

/* The type of an image by its bytes, whatever its file is called; null for anything that is not one. */
export function imageType(bytes: Uint8Array): string | null {
    if (hasText(bytes, 0, PNG_SIGNATURE) && hasText(bytes, 12, 'IHDR')) {
        return 'image/png';
    }
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[3]! >= 0xc0 && bytes[3] !== 0xff) {
        return 'image/jpeg';
    }
    if (bytes.length >= 13 && (hasText(bytes, 0, 'GIF87a') || hasText(bytes, 0, 'GIF89a'))) {
        return 'image/gif';
    }
    if (hasText(bytes, 0, 'RIFF') && hasText(bytes, 8, 'WEBP') && WEBP_CHUNKS.some((chunk) => hasText(bytes, 12, chunk))) {
        return 'image/webp';
    }
    const heif = heifType(bytes);
    if (heif !== null) {
        return heif;
    }
    if (isBmp(bytes)) {
        return 'image/bmp';
    }
    if (isIco(bytes)) {
        return 'image/x-icon';
    }
    return isSvg(bytes) ? 'image/svg+xml' : null;
}

/*
 * Reads a regular file into `into` and no further than it holds, so a file that grew after its size
 * was taken still stops one byte past the limit. Opened without blocking, so a pipe put in its place
 * is turned away rather than waited on.
 */
export async function readAtMost(path: string, into: Buffer): Promise<number> {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    try {
        if (!(await handle.stat()).isFile()) {
            throw new NotAFile(path);
        }
        let length = 0;
        while (length < into.length) {
            const { bytesRead } = await handle.read(into, length, into.length - length, null);
            if (bytesRead === 0) {
                break;
            }
            length += bytesRead;
        }
        return length;
    } finally {
        await handle.close();
    }
}

const DISK: ImageFiles = {
    async size(path) {
        const info = await stat(path);
        if (!info.isFile()) {
            throw new NotAFile(path);
        }
        return info.size;
    },
    read: readAtMost
};

/* Rounded up to a tenth, so a size just past a limit never reads as the limit itself. */
function mebibytes(bytes: number): string {
    return `${Math.ceil((bytes / MIB) * 10) / 10} MiB`;
}

const NO_FILE = 'no image file there';
const NOT_AN_IMAGE = 'its bytes are not a PNG, JPEG, GIF, WebP, AVIF, HEIF, SVG, BMP or ICO image';

function unreadable(e: unknown): string {
    const code = e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : null;
    if (e instanceof NotAFile || code === 'ENOENT' || code === 'ENOTDIR') {
        return NO_FILE;
    }
    if (code === 'EACCES' || code === 'EPERM') {
        return 'this process may not read it';
    }
    return `it could not be read: ${e instanceof Error ? e.message : String(e)}`;
}

function base64Length(bytes: number): number {
    return 4 * Math.ceil(bytes / 3);
}

interface Image {
    readonly path: string;
    /* How often the page names it, and the UTF-8 bytes those names take, which its data: URI replaces. */
    uses: number;
    written: number;
}

interface Candidate extends Image {
    /* The fewest bytes it adds to the page, from its size on disk. */
    readonly estimate: number;
}

function imagesOf(html: string, references: readonly ImageReference[]): Image[] {
    const images = new Map<string, Image>();
    for (const reference of references) {
        const image = images.get(reference.path) ?? { path: reference.path, uses: 0, written: 0 };
        image.uses += 1;
        image.written += Buffer.byteLength(html.slice(reference.start, reference.end), 'utf8');
        images.set(reference.path, image);
    }
    return [...images.values()];
}

/* The image at a path as a data: URI, typed by its bytes, or why it is none. */
async function dataUri(files: ImageFiles, path: string, buffer: Buffer, imageLimit: number): Promise<string | ImageProblem> {
    let length: number;
    try {
        length = await files.read(path, buffer);
    } catch (e) {
        return { path, kind: 'missing', reason: unreadable(e) };
    }
    if (length > imageLimit) {
        return { path, kind: 'too-large', reason: `more than the ${mebibytes(imageLimit)} an image may be` };
    }
    const type = imageType(buffer.subarray(0, length));
    if (type === null) {
        return { path, kind: 'missing', reason: NOT_AN_IMAGE };
    }
    return `data:${type};base64,${buffer.toString('base64', 0, length)}`;
}

function growth(image: Image, uriLength: number): number {
    return image.uses * uriLength - image.written;
}

function withImages(html: string, references: readonly ImageReference[], uris: ReadonlyMap<string, string>): string {
    const parts: string[] = [];
    let cursor = 0;
    for (const reference of references) {
        const uri = uris.get(reference.path);
        if (uri !== undefined) {
            parts.push(html.slice(cursor, reference.start), uri);
            cursor = reference.end;
        }
    }
    parts.push(html.slice(cursor));
    return parts.join('');
}

/*
 * Every distinct path is sized before anything is read and read once, and only bytes that are an
 * image are embedded. A whole embed holds back room for the images still to come, so it stops before
 * reading what cannot fit; a partial one skips an image that would not fit and goes on.
 */
export async function embedLocalImages(html: string, options: EmbedOptions): Promise<EmbeddedPage> {
    const references = findImageReferences(html);
    if (references.length === 0) {
        return { html, problems: [], overflow: null };
    }
    const imageLimit = options.imageBytes ?? VISUAL_IMAGE_BYTES;
    const pageLimit = options.pageBytes ?? VISUAL_LIMITS.bytes;
    const files = options.files ?? DISK;
    const images = imagesOf(html, references);
    const problems = new Map<string, ImageProblem>();
    const tooLarge = (path: string, reason: string): void => {
        problems.set(path, { path, kind: 'too-large', reason });
    };

    const candidates: Candidate[] = [];
    for (const image of images) {
        try {
            const size = await files.size(image.path);
            if (size > imageLimit) {
                tooLarge(image.path, `${mebibytes(size)}, more than the ${mebibytes(imageLimit)} an image may be`);
            } else {
                candidates.push({ ...image, estimate: growth(image, SHORTEST_PREFIX + base64Length(size)) });
            }
        } catch (e) {
            problems.set(image.path, { path: image.path, kind: 'missing', reason: unreadable(e) });
        }
    }

    const uris = new Map<string, string>();
    let bytes = Buffer.byteLength(html, 'utf8');
    let ahead = options.partial ? 0 : candidates.reduce((sum, candidate) => sum + candidate.estimate, 0);
    let overflow: number | null = null;
    let buffer: Buffer | null = null;
    const fits = (grows: number): boolean => bytes + ahead + grows <= pageLimit;
    for (const candidate of candidates) {
        if (!options.partial) {
            ahead -= candidate.estimate;
        }
        let grows = candidate.estimate;
        let uri: string | null = null;
        if (fits(grows)) {
            buffer ??= Buffer.allocUnsafe(imageLimit + 1);
            const read = await dataUri(files, candidate.path, buffer, imageLimit);
            if (typeof read !== 'string') {
                problems.set(candidate.path, read);
                continue;
            }
            uri = read;
            grows = growth(candidate, uri.length);
        }
        if (uri === null || !fits(grows)) {
            if (!options.partial) {
                overflow = bytes + ahead + grows;
                break;
            }
            tooLarge(candidate.path, `with it the page would pass the ${mebibytes(pageLimit)} a visual may be`);
            continue;
        }
        bytes += grows;
        uris.set(candidate.path, uri);
    }
    return {
        html: withImages(html, references, uris),
        problems: images.flatMap((image) => problems.get(image.path) ?? []),
        overflow
    };
}

export function problemLine(problem: ImageProblem): string {
    return `${problem.kind}\t${field(problem.path)}\tnot embedded: ${problem.reason}`;
}

function listed(problems: readonly ImageProblem[]): string {
    return problems.map((problem) => problem.path).join(', ');
}

/* What `visual show` is refused with when the page cannot go out with every image it names. */
function showRefusal(page: EmbeddedPage, imageLimit: number, pageLimit: number): { code: string; message: string; lines: string[] } | null {
    const lines = [...page.problems.map(problemLine), HELP_LINE];
    const missing = page.problems.filter((problem) => problem.kind === 'missing');
    if (missing.length > 0) {
        const one = missing.length === 1;
        return {
            code: 'visual-images-missing',
            message: `The page names ${one ? 'a path' : `${missing.length} paths`} with no image file on this machine: ${listed(missing)}; use absolute paths to existing image files, or remove ${one ? 'it' : 'them'} from the page`,
            lines
        };
    }
    const large = page.problems.filter((problem) => problem.kind === 'too-large');
    if (large.length > 0) {
        const them = large.length === 1 ? 'it' : 'them';
        return {
            code: 'visual-image-too-large',
            message: `An image may be at most ${mebibytes(imageLimit)}, and the page names ${large.length === 1 ? 'one' : large.length} larger: ${listed(large)}; scale ${them} down, or refer to ${them} by an http(s) URL`,
            lines
        };
    }
    if (page.overflow !== null) {
        return {
            code: 'visual-too-large',
            message: `With its images embedded the page would be at least ${mebibytes(page.overflow)}, and a visual may be at most ${mebibytes(pageLimit)}; embed fewer or smaller images, or refer to them by their http(s) URL`,
            lines
        };
    }
    return null;
}

/* Where the page is among the words: `--html=<page>`, or `--html` with the page after it. */
function pageIndex(argv: readonly string[]): { index: number; inline: boolean } | null {
    const index = argv.findIndex((word) => word === '--html' || word.startsWith('--html='));
    if (index === -1) {
        return null;
    }
    const inline = argv[index] !== '--html';
    return inline || index + 1 < argv.length ? { index, inline } : null;
}

/*
 * The words of `visual show` or `visual preview` with the page's local images embedded. A show is
 * refused here when an image cannot go along, so nothing goes out; a preview embeds what it can and
 * hands back a line per image it left as written.
 */
export async function prepareVisualPage(action: 'show' | 'preview', argv: string[], options: Omit<EmbedOptions, 'partial'> = {}): Promise<PreparedPage> {
    const at = pageIndex(argv);
    if (at === null) {
        return { argv, lines: [] };
    }
    const html = at.inline ? argv[at.index]!.slice('--html='.length) : argv[at.index + 1]!;
    const page = await embedLocalImages(html, { ...options, partial: action === 'preview' });
    if (action === 'show') {
        const refusal = showRefusal(page, options.imageBytes ?? VISUAL_IMAGE_BYTES, options.pageBytes ?? VISUAL_LIMITS.bytes);
        if (refusal !== null) {
            return { refusal };
        }
    }
    const words = [...argv];
    if (at.inline) {
        words[at.index] = `--html=${page.html}`;
    } else {
        words[at.index + 1] = page.html;
    }
    return { argv: words, lines: page.problems.map(problemLine) };
}
