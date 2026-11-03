import { ARTIFACT_KEY_PATTERN, ARTIFACT_LIMITS, type ArtifactKind } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents';
import { sniffMime } from '../fs/sniff.ts';

type ArtifactErrorCode =
    | 'not-found'
    | 'bad-name'
    | 'bad-key'
    | 'key-reserved'
    | 'bad-path'
    | 'exists'
    | 'symlink'
    | 'too-large'
    | 'disk-full'
    | 'upload-mismatch'
    | 'upload-incomplete'
    | 'too-many-uploads'
    | 'not-an-image'
    | 'outside-project'
    | 'chat-elsewhere'
    | 'not-linked'
    | 'machine-unreachable'
    | 'hash-mismatch'
    | 'bad-reply';

/* Never carries a title, a file name or content: the first line of a message may reach a report. */
export class ArtifactError extends CodedError<ArtifactErrorCode> {}

// Keys the daemon gives the outputs of routines; nobody else may claim one.
const RESERVED_KEY_PREFIX = 'routine:';

/* A key a person or an agent asks for, refused when it is malformed or one only the daemon gives. */
export function checkKey(key: string): string {
    if (key.startsWith(RESERVED_KEY_PREFIX)) {
        throw new ArtifactError('key-reserved', 'Keys starting with routine: belong to the machine');
    }
    if (!ARTIFACT_KEY_PATTERN.test(key)) {
        throw new ArtifactError('bad-key', 'A key is 1 to 64 lowercase letters, digits and dashes, starting with a letter or a digit');
    }
    return key;
}

/*
 * A file's name as a label: relative, no `..`, no empty or dot segments and no control characters.
 * It is what Copy to project suggests and is never a path in the store.
 */
export function checkFileName(name: string): string {
    const segments = name.split('/');
    const bad =
        name.length === 0 ||
        name.length > ARTIFACT_LIMITS.fileNameLength ||
        name.includes('\\') ||
        // oxlint-disable-next-line no-control-regex -- a control character in a name is what this refuses.
        /[\u0000-\u001f\u007f]/.test(name) ||
        segments.some((segment) => segment === '' || segment === '.' || segment === '..');
    if (bad) {
        throw new ArtifactError('bad-name', 'A file name is relative, without .. or empty parts, and at most 255 characters');
    }
    return name;
}

// The folders of a project nobody writes a copy into: its own files and its repository.
const GUARDED_FOLDERS = new Set(['.ruimte', '.git']);

/* The segments of a path relative to a project folder, refused when it is absolute, climbs out or lands in the project's own files. */
export function relativeSegments(path: string): string[] {
    const normalized = path.replaceAll('\\', '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
        throw new ArtifactError('bad-path', 'The path is relative to the project folder');
    }
    const segments = normalized.split('/').filter((segment) => segment !== '' && segment !== '.');
    if (segments.length === 0 || segments.some((segment) => segment === '..')) {
        throw new ArtifactError('bad-path', 'The path stays inside the project folder, without ..');
    }
    if (GUARDED_FOLDERS.has(segments[0]!)) {
        throw new ArtifactError('bad-path', 'A copy never goes into .ruimte or .git');
    }
    return segments;
}

const TEXT_TYPES: Readonly<Record<string, string>> = {
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    log: 'text/plain',
    html: 'text/html',
    htm: 'text/html',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    json: 'application/json',
    svg: 'image/svg+xml',
    xml: 'application/xml',
    yaml: 'application/yaml',
    yml: 'application/yaml'
};

const OCTET = 'application/octet-stream';

function extensionOf(name: string): string {
    const base = name.slice(name.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

function isUtf8Text(head: Uint8Array): boolean {
    if (head.includes(0)) {
        return false;
    }
    try {
        // A head cut inside a character is still text; only the last three bytes may be half of one.
        new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, Math.max(0, head.length - 3)));
        return true;
    } catch {
        return false;
    }
}

/*
 * What a file is: its bytes first, so a picture named `.txt` is still a picture, then the name for
 * the text formats bytes cannot tell apart, and binary for whatever is no text at all.
 */
export function mimeOf(name: string, head: Uint8Array, size: number): string {
    const sniffed = sniffMime(head, size);
    if (sniffed !== null) {
        return sniffed;
    }
    if (!isUtf8Text(head)) {
        return OCTET;
    }
    return TEXT_TYPES[extensionOf(name)] ?? (size === 0 ? OCTET : 'text/plain');
}

/* The kind a version is when nobody named one, read off its first file. */
export function kindOf(mime: string): ArtifactKind {
    if (mime === 'text/html') {
        return 'page';
    }
    if (mime.startsWith('image/')) {
        return 'image';
    }
    if (mime.startsWith('video/') || mime.startsWith('audio/')) {
        return 'recording';
    }
    if (mime === 'text/markdown' || mime === 'text/plain') {
        return 'report';
    }
    if (mime === 'text/csv' || mime === 'text/tab-separated-values' || mime === 'application/json') {
        return 'export';
    }
    return 'build';
}

/* Whether a file reads as text, which is what an agent's `artifact_read` prints. */
export function isTextMime(mime: string): boolean {
    return mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || mime === 'application/yaml' || mime === 'image/svg+xml';
}

// Read off a file's first bytes; enough for every format `sniffMime` knows.
export const SNIFF_HEAD_BYTES = 4096;
