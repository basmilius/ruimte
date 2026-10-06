import { lstat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { FS_READ_MAX_TEXT_BYTES, isAudioMime, isImageMime, isPdfMime, isVideoMime, type FsReadResult } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents/coded-error';
import { looksLikeSvg, sniffMime } from './sniff.ts';

type ReadErrorCode = 'not-found' | 'not-a-file' | 'bad-path';

export class ReadError extends CodedError<ReadErrorCode> {}

// The sniff only ever looks at the head of a file; a megabyte of prose says nothing more than its first page.
export const SNIFF_BYTES = 8 * 1024;

// Past this share of control characters the bytes are not text, whatever they decode to.
const CONTROL_RATIO = 0.1;

/* Tab, newline, carriage return and form feed belong in text; escape does too, since a log full of ANSI is still readable. */
function isTextControl(byte: number): boolean {
    return byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x1b;
}

/*
 * Whether the head of a file reads as text. A NUL settles it (that is what UTF-16 and every
 * executable carry), and so does a head that will not decode as UTF-8; a burst of other control
 * bytes is the last tell for the formats that pass both. A head cut off at the sniff length can
 * split a multi-byte character in half, so its last three bytes are not evidence of anything.
 */
export function looksBinary(bytes: Uint8Array, truncated = false): boolean {
    if (bytes.length === 0) {
        return false;
    }
    let control = 0;
    for (const byte of bytes) {
        if (byte === 0) {
            return true;
        }
        if (byte < 0x20 && !isTextControl(byte)) {
            control++;
        }
    }
    if (control / bytes.length > CONTROL_RATIO) {
        return true;
    }
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(truncated ? bytes.subarray(0, bytes.length - 3) : bytes);
        return false;
    } catch {
        return true;
    }
}

const LANGUAGES: Record<string, string> = {
    astro: 'astro',
    c: 'c',
    cc: 'cpp',
    cjs: 'javascript',
    cpp: 'cpp',
    cs: 'csharp',
    css: 'css',
    dart: 'dart',
    diff: 'diff',
    dockerfile: 'docker',
    ex: 'elixir',
    exs: 'elixir',
    fish: 'fish',
    go: 'go',
    graphql: 'graphql',
    h: 'c',
    hpp: 'cpp',
    htm: 'html',
    html: 'html',
    ini: 'ini',
    java: 'java',
    js: 'javascript',
    json: 'json',
    json5: 'json5',
    jsonc: 'jsonc',
    jsx: 'jsx',
    kt: 'kotlin',
    less: 'less',
    lua: 'lua',
    markdown: 'markdown',
    md: 'markdown',
    mdx: 'mdx',
    mjs: 'javascript',
    mts: 'typescript',
    patch: 'diff',
    php: 'php',
    phtml: 'php',
    pl: 'perl',
    prisma: 'prisma',
    ps1: 'powershell',
    py: 'python',
    r: 'r',
    rb: 'ruby',
    rs: 'rust',
    scala: 'scala',
    scss: 'scss',
    sh: 'shellscript',
    sql: 'sql',
    svelte: 'svelte',
    swift: 'swift',
    toml: 'toml',
    ts: 'typescript',
    tsx: 'tsx',
    twig: 'twig',
    vue: 'vue',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    zig: 'zig',
    zsh: 'shellscript'
};

// Files a person knows by name alone; there is no extension to go on.
const BY_NAME: Record<string, string> = {
    '.env': 'dotenv',
    '.gitignore': 'ignore',
    '.gitattributes': 'ignore',
    dockerfile: 'docker',
    makefile: 'make'
};

/* The highlighter id for a file name, or undefined when nothing here recognizes it. */
export function languageOf(name: string): string | undefined {
    const lower = name.toLowerCase();
    const dot = lower.lastIndexOf('.');
    return LANGUAGES[dot > 0 ? lower.slice(dot + 1) : ''] ?? BY_NAME[lower];
}

function baseName(path: string): string {
    return path.split(/[/\\]/).pop() ?? path;
}

// The device and inode say which file was looked at, so a write can tell that file from one swapped in under its name.
export interface FileStat {
    path: string;
    size: number;
    mtime: number;
    dev: number;
    ino: number;
}

/*
 * The path a read may touch. Absolute the way `fs.list` answers one, and never a symlink: a listing
 * is never walked into one either, so a link inside a folder cannot hand the viewer a file that
 * folder does not hold.
 */
async function statFile(path: string): Promise<FileStat> {
    if (path.includes('\0') || !isAbsolute(path)) {
        throw new ReadError('bad-path', 'A file is read by its absolute path');
    }
    const resolved = resolve(path);
    const stats = await lstat(resolved).catch(() => null);
    if (!stats) {
        throw new ReadError('not-found', 'That file is not there');
    }
    if (stats.isSymbolicLink()) {
        throw new ReadError('not-a-file', 'That path is a symbolic link. Ruimte does not follow links.');
    }
    if (!stats.isFile()) {
        throw new ReadError('not-a-file', 'That path is not a file');
    }
    return { path: resolved, size: stats.size, mtime: Math.round(stats.mtimeMs), dev: stats.dev, ino: stats.ino };
}

export const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function startsWithBom(head: Uint8Array): boolean {
    return UTF8_BOM.every((byte, index) => head[index] === byte);
}

/*
 * What the head of a file says it is, before anything decides to read the rest of it. A null mime is
 * text. `bom` is whether it opens with a UTF-8 byte order mark, which decoding drops and a save puts back.
 */
export async function inspect(path: string): Promise<{ file: FileStat; mime: string | null; bom: boolean }> {
    const file = await statFile(path);
    const head = new Uint8Array(await Bun.file(file.path).slice(0, SNIFF_BYTES).arrayBuffer());
    const bom = startsWithBom(head);
    const magic = sniffMime(head);
    if (magic) {
        return { file, mime: magic, bom };
    }
    if (looksBinary(head, head.length === SNIFF_BYTES)) {
        return { file, mime: 'application/octet-stream', bom };
    }
    return { file, mime: looksLikeSvg(head) ? 'image/svg+xml' : null, bom };
}

/* The whole file as text, or null when a byte past the head is not UTF-8 after all; text with
   replacement characters in it would be saved over the original. */
function decodeWhole(bytes: Uint8Array): string | null {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return null;
    }
}

/*
 * One file for the viewer. Text comes back decoded, an image or another known format comes back as
 * its mime alone (the bytes travel over `GET /fs/file`), and a text file past the cap comes back as
 * its size and mtime, so the client fetches the bytes over that route instead of one frame on the socket.
 */
export async function readFile(path: string): Promise<FsReadResult> {
    const { file, mime } = await inspect(path);
    if (mime) {
        return { kind: 'binary', mime, size: file.size, mtime: file.mtime };
    }
    if (file.size > FS_READ_MAX_TEXT_BYTES) {
        return { kind: 'too-large', size: file.size, mtime: file.mtime };
    }
    const text = decodeWhole(await Bun.file(file.path).bytes());
    if (text === null) {
        return { kind: 'binary', mime: 'application/octet-stream', size: file.size, mtime: file.mtime };
    }
    return {
        kind: 'text',
        text,
        encoding: 'utf-8',
        size: file.size,
        mtime: file.mtime,
        language: languageOf(baseName(file.path))
    };
}

// Whatever its name says, so an HTML file the route serves never runs in the origin of the page that asked.
export const SERVED_TEXT_MIME = 'text/plain; charset=utf-8';

/* The same file as bytes, for the file route and `bytes.read`: an image, video, sound, a PDF or text. Null for any other binary. */
export async function readServedFile(path: string): Promise<{ mime: string; size: number; bytes: Blob } | null> {
    const { file, mime } = await inspect(path);
    if (mime === null) {
        return { mime: SERVED_TEXT_MIME, size: file.size, bytes: Bun.file(file.path) };
    }
    if (!(isImageMime(mime) || isVideoMime(mime) || isAudioMime(mime) || isPdfMime(mime))) {
        return null;
    }
    return { mime, size: file.size, bytes: Bun.file(file.path) };
}
