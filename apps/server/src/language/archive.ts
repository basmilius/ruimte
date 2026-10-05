import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';

export type ArchiveFormat = 'tar.gz' | 'zip';

/* A file of an archive; folders, links and anything else are left out. `data` may be a view into the archive's own bytes. */
export interface ArchiveEntry {
    /* POSIX, as the archive names it. */
    path: string;
    data: Uint8Array;
    mode: number;
}

const TAR_BLOCK = 512;

function tarText(header: Uint8Array, start: number, length: number): string {
    const field = header.subarray(start, start + length);
    const end = field.indexOf(0);
    return new TextDecoder().decode(end === -1 ? field : field.subarray(0, end));
}

function tarNumber(header: Uint8Array, start: number, length: number): number {
    const text = tarText(header, start, length).trim();
    return text === '' ? 0 : Number.parseInt(text, 8);
}

/* The `path` record of a PAX extended header, which holds the names that do not fit a ustar header. */
function paxPath(data: Uint8Array): string | null {
    const text = new TextDecoder().decode(data);
    for (const record of text.split('\n')) {
        const match = /^\d+ path=(.*)$/.exec(record);
        if (match) {
            return match[1]!;
        }
    }
    return null;
}

function readTar(tar: Uint8Array): ArchiveEntry[] {
    const entries: ArchiveEntry[] = [];
    let longName: string | null = null;
    let offset = 0;
    while (offset + TAR_BLOCK <= tar.length) {
        const header = tar.subarray(offset, offset + TAR_BLOCK);
        if (header.every((byte) => byte === 0)) {
            break;
        }
        const size = tarNumber(header, 124, 12);
        const type = String.fromCharCode(header[156] ?? 0);
        const data = tar.subarray(offset + TAR_BLOCK, offset + TAR_BLOCK + size);
        if (data.length < size) {
            throw new Error('The archive ends in the middle of a file');
        }
        offset += TAR_BLOCK + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
        if (type === 'x') {
            longName = paxPath(data) ?? longName;
            continue;
        }
        if (type === 'L') {
            longName = tarText(data, 0, data.length);
            continue;
        }
        if (type === 'g') {
            continue;
        }
        const prefix = tarText(header, 345, 155);
        const name = longName ?? (prefix === '' ? tarText(header, 0, 100) : `${prefix}/${tarText(header, 0, 100)}`);
        longName = null;
        if (type === '0' || type === '\0') {
            entries.push({ path: name, data, mode: tarNumber(header, 100, 8) });
        }
    }
    return entries;
}

const ZIP_END_OF_DIRECTORY = 0x06054b50;
const ZIP_DIRECTORY_ENTRY = 0x02014b50;
const ZIP_LOCAL_ENTRY = 0x04034b50;
const ZIP_UNIX = 3;

function readZip(zip: Uint8Array): ArchiveEntry[] {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let end = zip.length - 22;
    while (end >= 0 && view.getUint32(end, true) !== ZIP_END_OF_DIRECTORY) {
        end--;
    }
    if (end < 0) {
        throw new Error('The archive is not a zip file');
    }
    const count = view.getUint16(end + 10, true);
    let cursor = view.getUint32(end + 16, true);
    const entries: ArchiveEntry[] = [];
    for (let i = 0; i < count; i++) {
        if (view.getUint32(cursor, true) !== ZIP_DIRECTORY_ENTRY) {
            throw new Error('The zip directory is damaged');
        }
        const madeBy = view.getUint16(cursor + 4, true) >> 8;
        const method = view.getUint16(cursor + 10, true);
        const compressedSize = view.getUint32(cursor + 20, true);
        const nameLength = view.getUint16(cursor + 28, true);
        const extraLength = view.getUint16(cursor + 30, true);
        const commentLength = view.getUint16(cursor + 32, true);
        const attributes = view.getUint32(cursor + 38, true);
        const localOffset = view.getUint32(cursor + 42, true);
        const name = new TextDecoder().decode(zip.subarray(cursor + 46, cursor + 46 + nameLength));
        cursor += 46 + nameLength + extraLength + commentLength;
        if (name.endsWith('/')) {
            continue;
        }
        if (view.getUint32(localOffset, true) !== ZIP_LOCAL_ENTRY) {
            throw new Error('The zip directory points at a damaged entry');
        }
        const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        const stored = zip.subarray(start, start + compressedSize);
        if (method !== 0 && method !== 8) {
            throw new Error(`The zip entry ${name} uses compression method ${method}`);
        }
        entries.push({ path: name, data: method === 0 ? stored : inflateRawSync(stored), mode: madeBy === ZIP_UNIX ? attributes >>> 16 : 0o644 });
    }
    return entries;
}

export function readArchive(bytes: Uint8Array, format: ArchiveFormat): ArchiveEntry[] {
    return format === 'zip' ? readZip(bytes) : readTar(gunzipSync(bytes));
}

export interface ExtractOptions {
    /* Leading folders to drop from every path, such as the one GitHub wraps a commit in. */
    strip?: number;
    /* Whether a file, by its path after the strip, is written. */
    keep?: (path: string) => boolean;
}

/*
 * Writes the files of an archive under a folder and answers their paths after the strip. A path
 * that is absolute or climbs out with `..` is skipped, so an archive can never write outside the
 * folder it was given.
 */
export async function extractEntries(entries: readonly ArchiveEntry[], destination: string, options: ExtractOptions = {}): Promise<string[]> {
    const written: string[] = [];
    for (const entry of entries) {
        const parts = entry.path.split('/').filter((part) => part !== '' && part !== '.');
        const relative = parts.slice(options.strip ?? 0).join('/');
        if (relative === '' || relative.includes('\0') || posix.isAbsolute(entry.path) || parts.includes('..') || options.keep?.(relative) === false) {
            continue;
        }
        const target = join(destination, relative);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, entry.data);
        await chmod(target, entry.mode & 0o111 ? 0o755 : 0o644);
        written.push(relative);
    }
    return written;
}
