import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { PROJECT_DIR } from './project-files.ts';

// A logo is a few kilobytes; anything past this is a photo that happens to be called icon.png.
export const ICON_MAX_BYTES = 256 * 1024;

// `.idea/.name` holds one line. A file that is bigger is not that file.
const NAME_MAX_BYTES = 4 * 1024;
const NAME_MAX_CHARS = 64;

// A folder is not re-read on every list; an icon dropped in by hand shows up within this window.
export const DERIVE_TTL_MS = 5 * 60 * 1000;

// Only the `index.html` at the root is scanned, and only this far in: the head is at the top.
const HTML_SCAN_BYTES = 16 * 1024;

const IDEA_NAME_FILE = '.idea/.name';

/*
 * Where a project may declare its icon, best first. Ours comes before the editors' because it is
 * the one a person sets from inside the app; the favicons are last because they are a guess.
 */
const ICON_CANDIDATES = [
    `${PROJECT_DIR}/icon.svg`,
    `${PROJECT_DIR}/icon.png`,
    `${PROJECT_DIR}/icon.jpg`,
    `${PROJECT_DIR}/icon.jpeg`,
    `${PROJECT_DIR}/icon.gif`,
    `${PROJECT_DIR}/icon.webp`,
    '.idea/icon.svg',
    '.idea/icon.png',
    '.vscode/icon.svg',
    '.vscode/icon.png',
    'favicon.svg',
    'favicon.ico',
    'favicon.png',
    'public/favicon.svg',
    'public/favicon.ico',
    'public/favicon.png',
    'public/icon.svg',
    'public/icon.png',
    'app/favicon.ico',
    'app/icon.svg',
    'app/icon.png',
    'src/favicon.svg',
    'src/favicon.ico',
    'src/app/favicon.ico',
    'src/app/icon.svg',
    'src/app/icon.png',
    'assets/icon.svg',
    'assets/icon.png',
    'assets/logo.svg',
    'assets/logo.png'
] as const;

const HTML_CANDIDATE = 'index.html';

export interface DerivedIcon {
    // Relative to the folder, so it reads as "from .idea/icon.svg" without leaking the path.
    from: string;
    mime: string;
    // Changes whenever the bytes do, so the URL is safe to cache forever.
    version: string;
    lightPath: string;
    // `<name>_dark.<ext>` next to the file, for the dark theme.
    darkPath: string | null;
    darkMime: string | null;
}

export interface DerivedIdentity {
    icon: DerivedIcon | null;
    // The folder itself could not be read (unmounted, no permission); nothing was ruled out.
    unresolved: boolean;
}

const EMPTY: DerivedIdentity = { icon: null, unresolved: false };

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean => signature.every((byte, index) => bytes[offset + index] === byte);

/*
 * The MIME of an image from its first bytes. The extension is what a person typed; these are what
 * the file is, which is what a browser will act on.
 */
export const sniffMime = (bytes: Uint8Array): string | null => {
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return 'image/png';
    }
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
        return 'image/jpeg';
    }
    if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
        return 'image/gif';
    }
    if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
        return 'image/webp';
    }
    // An .ico with image type 1; type 2 is a cursor, which is not an icon we want to serve.
    if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) {
        return 'image/vnd.microsoft.icon';
    }
    if (looksLikeSvg(bytes)) {
        return 'image/svg+xml';
    }
    return null;
};

const looksLikeSvg = (bytes: Uint8Array): boolean => {
    // A BOM, a declaration or a comment may come first, so the tag is looked for in the head.
    const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 1024)).toLowerCase();
    return head.includes('<svg');
};

/* True while `path` stays inside `folder`, symlinks resolved. */
const isInside = (folder: string, path: string): boolean => {
    const rel = relative(folder, path);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/*
 * Resolves a candidate to a real file inside the folder. A symlink that points out of the folder
 * is refused after `realpath`, so a repository cannot hand the daemon someone's private key.
 */
const jailedFile = async (folder: string, candidate: string): Promise<{ path: string; size: number; mtimeMs: number } | null> => {
    if (candidate.includes('\0') || isAbsolute(candidate)) {
        return null;
    }
    const path = resolve(folder, candidate);
    if (!isInside(folder, path)) {
        return null;
    }
    let real: string;
    try {
        real = await realpath(path);
    } catch {
        return null;
    }
    let realFolder: string;
    try {
        realFolder = await realpath(folder);
    } catch {
        return null;
    }
    if (!isInside(realFolder, real)) {
        return null;
    }
    try {
        const info = await stat(real);
        if (!info.isFile()) {
            return null;
        }
        return { path: real, size: info.size, mtimeMs: info.mtimeMs };
    } catch {
        return null;
    }
};

/* The bytes of a candidate with its sniffed MIME, or null when it is missing, too big or not an image. */
const readImage = async (folder: string, candidate: string): Promise<{ path: string; mime: string; size: number; mtimeMs: number } | null> => {
    const file = await jailedFile(folder, candidate);
    if (!file || file.size === 0 || file.size > ICON_MAX_BYTES) {
        return null;
    }
    let bytes: Uint8Array;
    try {
        bytes = await readFile(file.path);
    } catch {
        return null;
    }
    const mime = sniffMime(bytes);
    if (!mime) {
        return null;
    }
    return { path: file.path, mime, size: file.size, mtimeMs: file.mtimeMs };
};

const darkVariantOf = (candidate: string): string => {
    const ext = extname(candidate);
    return `${candidate.slice(0, candidate.length - ext.length)}_dark${ext}`;
};

const versionOf = (light: { size: number; mtimeMs: number }, dark: { size: number; mtimeMs: number } | null): string => {
    const stamp = (file: { size: number; mtimeMs: number }): string => `${Math.round(file.mtimeMs)}-${file.size}`;
    return dark ? `${stamp(light)}.${stamp(dark)}` : stamp(light);
};

const toDerived = async (folder: string, candidate: string, light: { path: string; mime: string; size: number; mtimeMs: number }): Promise<DerivedIcon> => {
    const dark = await readImage(folder, darkVariantOf(candidate));
    return {
        from: candidate,
        mime: light.mime,
        version: versionOf(light, dark),
        lightPath: light.path,
        darkPath: dark?.path ?? null,
        darkMime: dark?.mime ?? null
    };
};

/* The `href` of the first `<link rel="icon">` in an HTML head, or null. */
export const faviconHref = (html: string): string | null => {
    for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
        const rel = tag.match(/\brel\s*=\s*["']?([^"'>\s]+)/i)?.[1]?.toLowerCase();
        if (!rel || !/(^|\s)(icon|shortcut)(\s|$)/.test(rel.replace(/-/g, ' '))) {
            continue;
        }
        const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
        if (href && !href.startsWith('data:') && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//')) {
            return href;
        }
    }
    return null;
};

const iconFromHtml = async (folder: string): Promise<DerivedIcon | null> => {
    const file = await jailedFile(folder, HTML_CANDIDATE);
    if (!file || file.size === 0) {
        return null;
    }
    let html: string;
    try {
        html = (await readFile(file.path)).subarray(0, HTML_SCAN_BYTES).toString('utf8');
    } catch {
        return null;
    }
    const href = faviconHref(html);
    if (!href) {
        return null;
    }
    const cleaned = href.split(/[?#]/)[0]!.replace(/^\/+/, '');
    if (cleaned === '') {
        return null;
    }
    // A Vite or CRA page names its favicon as the browser sees it; on disk that is under `public/`.
    for (const candidate of [`public/${cleaned}`, cleaned]) {
        const light = await readImage(folder, candidate);
        if (light) {
            return toDerived(folder, candidate, light);
        }
    }
    return null;
};

/*
 * The name `.idea/.name` declares, or null when the folder declares none. Asked once, when a
 * folder gets its first canvas; after that the name lives in `project.json` and this file is
 * never read again, so an editor renaming its own project never renames ours.
 */
export const readIdeaName = async (folder: string): Promise<string | null> => {
    const file = await jailedFile(folder, IDEA_NAME_FILE);
    if (!file || file.size === 0 || file.size > NAME_MAX_BYTES) {
        return null;
    }
    let text: string;
    try {
        text = await readFile(file.path, 'utf8');
    } catch {
        return null;
    }
    for (const line of text.split(/\r?\n/)) {
        // A name ends up in a window title and a menu row, so control characters go first.
        const cleaned = [...line]
            .filter((char) => char >= ' ' && char !== '\u007f')
            .join('')
            .trim();
        if (cleaned !== '') {
            return cleaned.slice(0, NAME_MAX_CHARS);
        }
    }
    return null;
};

/*
 * What a folder says about itself: an icon file, if it has one. Nothing is written back and
 * nothing is remembered on disk, so a folder stays the source of truth for its icon.
 */
export const deriveIdentity = async (folder: string): Promise<DerivedIdentity> => {
    try {
        if (!(await stat(folder)).isDirectory()) {
            return EMPTY;
        }
    } catch {
        // The folder could not be read at all; that is not the same as "declares nothing".
        return { icon: null, unresolved: true };
    }
    for (const candidate of ICON_CANDIDATES) {
        const light = await readImage(folder, candidate);
        if (light) {
            return { icon: await toDerived(folder, candidate, light), unresolved: false };
        }
    }
    return { icon: await iconFromHtml(folder), unresolved: false };
};

/* Keeps a folder's answer for a few minutes; a folder that could not be read is asked again. */
export class IdentityCache {
    private readonly entries = new Map<string, { at: number; identity: DerivedIdentity }>();
    private readonly ttlMs: number;
    private readonly now: () => number;

    constructor(ttlMs: number = DERIVE_TTL_MS, now: () => number = Date.now) {
        this.ttlMs = ttlMs;
        this.now = now;
    }

    async resolve(folder: string): Promise<DerivedIdentity> {
        const key = normalizeKey(folder);
        const cached = this.entries.get(key);
        if (cached && this.now() - cached.at < this.ttlMs) {
            return cached.identity;
        }
        const identity = await deriveIdentity(folder);
        if (!identity.unresolved) {
            this.entries.set(key, { at: this.now(), identity });
        }
        return identity;
    }

    invalidate(folder: string): void {
        this.entries.delete(normalizeKey(folder));
    }

    clear(): void {
        this.entries.clear();
    }
}

const normalizeKey = (folder: string): string => {
    const path = resolve(folder);
    return path.length > 1 && path.endsWith(sep) ? path.slice(0, -1) : path;
};
