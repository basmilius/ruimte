import { lstat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { FS_READ_MAX_TEXT_BYTES, isImageMime, isVideoMime, type FsReadResult } from '@ruimte/contracts';

type ReadErrorCode = 'not-found' | 'not-a-file' | 'bad-path';

export class ReadError extends Error {
    readonly code: ReadErrorCode;

    constructor(code: ReadErrorCode, message: string) {
        super(message);
        this.name = 'ReadError';
        this.code = code;
    }
}

// The sniff only ever looks at the head of a file; a megabyte of prose says nothing more than its first page.
export const SNIFF_BYTES = 8 * 1024;

// Past this share of control characters the bytes are not text, whatever they decode to.
const CONTROL_RATIO = 0.1;

/* Tab, newline, carriage return and form feed belong in text; escape does too, since a log full of ANSI is still readable. */
const isTextControl = (byte: number): boolean => byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x1b;

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
    bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

const MAGIC: readonly { mime: string; signature: readonly number[] }[] = [
    { mime: 'image/png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { mime: 'image/jpeg', signature: [0xff, 0xd8, 0xff] },
    { mime: 'image/gif', signature: ascii('GIF87a') },
    { mime: 'image/gif', signature: ascii('GIF89a') },
    { mime: 'application/pdf', signature: ascii('%PDF-') }
];

// Brands an `ftyp` box can carry that hold sound and no picture; the container is the same as MP4's.
const AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ']);

const latin1 = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes);

/* The mime a file's first bytes claim, or null when nothing recognizes them. */
export const sniffMime = (bytes: Uint8Array): string | null => {
    for (const { mime, signature } of MAGIC) {
        if (startsWith(bytes, signature)) {
            return mime;
        }
    }
    // WebP is a RIFF container: the form type sits four bytes past the length.
    if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes.subarray(8), ascii('WEBP'))) {
        return 'image/webp';
    }
    // An ISO base media file (MP4, M4V, MOV) names itself in an `ftyp` box four bytes in, and the
    // brand behind it says which flavor: QuickTime carries codecs no browser has to play.
    if (startsWith(bytes.subarray(4), ascii('ftyp'))) {
        const brand = latin1(bytes.subarray(8, 12));
        if (AUDIO_BRANDS.has(brand)) {
            return null;
        }
        return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
    }
    // WebM and Matroska share the EBML header; the DocType a few bytes in is what tells them apart.
    if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
        return latin1(bytes.subarray(0, 64)).includes('webm') ? 'video/webm' : 'video/x-matroska';
    }
    if (startsWith(bytes, ascii('OggS'))) {
        return 'video/ogg';
    }
    return null;
};

/*
 * SVG is text, and the viewer still wants an image. Only a file that opens as one counts: a markdown
 * page that mentions `<svg>` halfway down is prose, not a drawing.
 */
export const looksLikeSvg = (bytes: Uint8Array): boolean => {
    const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 1024)).replace(/^﻿/, '').trimStart();
    return (head.startsWith('<?xml') || head.startsWith('<!--') || head.startsWith('<svg')) && head.toLowerCase().includes('<svg');
};

/*
 * Whether the head of a file reads as text. A NUL settles it (that is what UTF-16 and every
 * executable carry), and so does a head that will not decode as UTF-8; a burst of other control
 * bytes is the last tell for the formats that pass both. A head cut off at the sniff length can
 * split a multi-byte character in half, so its last three bytes are not evidence of anything.
 */
export const looksBinary = (bytes: Uint8Array, truncated = false): boolean => {
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
};

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
export const languageOf = (name: string): string | undefined => {
    const lower = name.toLowerCase();
    const dot = lower.lastIndexOf('.');
    return LANGUAGES[dot > 0 ? lower.slice(dot + 1) : ''] ?? BY_NAME[lower];
};

const baseName = (path: string): string => path.split(/[/\\]/).pop() ?? path;

/*
 * The path a read may touch. Absolute the way `fs.list` answers one, and never a symlink: a listing
 * is never walked into one either, so a link inside a folder cannot hand the viewer a file that
 * folder does not hold.
 */
const statFile = async (path: string): Promise<{ path: string; size: number; mtime: number }> => {
    if (path.includes('\0') || !isAbsolute(path)) {
        throw new ReadError('bad-path', 'A file is read by its absolute path');
    }
    const resolved = resolve(path);
    const stats = await lstat(resolved).catch(() => null);
    if (!stats) {
        throw new ReadError('not-found', 'That file is not there');
    }
    if (stats.isSymbolicLink()) {
        throw new ReadError('not-a-file', 'That path is a link, and a link is not followed');
    }
    if (!stats.isFile()) {
        throw new ReadError('not-a-file', 'That path is not a file');
    }
    return { path: resolved, size: stats.size, mtime: Math.round(stats.mtimeMs) };
};

/* What the head of a file says it is, before anything decides to read the rest of it. */
const inspect = async (path: string): Promise<{ file: { path: string; size: number; mtime: number }; mime: string | null }> => {
    const file = await statFile(path);
    const head = new Uint8Array(await Bun.file(file.path).slice(0, SNIFF_BYTES).arrayBuffer());
    const magic = sniffMime(head);
    if (magic) {
        return { file, mime: magic };
    }
    if (looksBinary(head, head.length === SNIFF_BYTES)) {
        return { file, mime: 'application/octet-stream' };
    }
    return { file, mime: looksLikeSvg(head) ? 'image/svg+xml' : null };
};

/*
 * One file for the viewer. Text comes back decoded, an image or another known format comes back as
 * its mime alone (the bytes travel over `GET /fs/file`), and a text file past the cap comes back as
 * its size, so the panel can say so instead of pushing megabytes through the socket.
 */
export const readFile = async (path: string): Promise<FsReadResult> => {
    const { file, mime } = await inspect(path);
    if (mime) {
        return { kind: 'binary', mime, size: file.size, mtime: file.mtime };
    }
    if (file.size > FS_READ_MAX_TEXT_BYTES) {
        return { kind: 'too-large', size: file.size };
    }
    return {
        kind: 'text',
        text: await Bun.file(file.path).text(),
        encoding: 'utf-8',
        size: file.size,
        mtime: file.mtime,
        language: languageOf(baseName(file.path))
    };
};

/* The same file as bytes, for the file route. Null for anything but the images and video it serves. */
export const readMedia = async (path: string): Promise<{ mime: string; size: number; bytes: Blob } | null> => {
    const { file, mime } = await inspect(path);
    if (!mime || !(isImageMime(mime) || isVideoMime(mime))) {
        return null;
    }
    return { mime, size: file.size, bytes: Bun.file(file.path) };
};
