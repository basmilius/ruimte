import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw, gunzipSync, inflateRawSync } from 'node:zlib';

export type ArchiveFormat = 'tar.gz' | 'zip';

/* A file of an archive; folders, links and anything else are left out. `data` may be a view into the archive's own bytes. */
export interface ArchiveEntry {
    /* POSIX, as the archive names it. */
    path: string;
    data: Uint8Array;
    mode: number;
}

const TAR_BLOCK = 512;
const UTF8 = new TextDecoder();

function tarText(header: Uint8Array, start: number, length: number): string {
    const field = header.subarray(start, start + length);
    const end = field.indexOf(0);
    return UTF8.decode(end === -1 ? field : field.subarray(0, end));
}

function tarNumber(header: Uint8Array, start: number, length: number): number {
    const text = tarText(header, start, length).trim();
    return text === '' ? 0 : Number.parseInt(text, 8);
}

/* The `path` record of a PAX extended header, which holds the names that do not fit a ustar header. */
function paxPath(data: Uint8Array): string | null {
    const text = UTF8.decode(data);
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
const ZIP64_MARKER = 0xffffffff;

interface ZipRecord {
    name: string;
    method: number;
    compressedSize: number;
    localOffset: number;
    mode: number;
}

/* Where the end-of-directory record starts in `bytes`, the tail of a zip; throws when there is none. */
function endRecordIn(bytes: Uint8Array): DataView {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let end = bytes.length - 22; end >= 0; end--) {
        if (view.getUint32(end, true) === ZIP_END_OF_DIRECTORY) {
            return new DataView(bytes.buffer, bytes.byteOffset + end, 22);
        }
    }
    throw new Error('The archive is not a zip file');
}

/* The records of a central directory, folders included. */
function* zipRecords(directory: Uint8Array, count: number): Generator<ZipRecord> {
    const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
    let cursor = 0;
    for (let i = 0; i < count; i++) {
        if (view.getUint32(cursor, true) !== ZIP_DIRECTORY_ENTRY) {
            throw new Error('The zip directory is damaged');
        }
        const nameLength = view.getUint16(cursor + 28, true);
        const madeBy = view.getUint16(cursor + 4, true) >> 8;
        yield {
            name: UTF8.decode(directory.subarray(cursor + 46, cursor + 46 + nameLength)),
            method: view.getUint16(cursor + 10, true),
            compressedSize: view.getUint32(cursor + 20, true),
            localOffset: view.getUint32(cursor + 42, true),
            mode: madeBy === ZIP_UNIX ? view.getUint32(cursor + 38, true) >>> 16 : 0o644
        };
        cursor += 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    }
}

function requireMethod(record: ZipRecord): void {
    if (record.method !== 0 && record.method !== 8) {
        throw new Error(`The zip entry ${record.name} uses compression method ${record.method}`);
    }
}

/* Where an entry's data starts, past a local header of 30 bytes whose name and extra may differ from the directory's. */
function dataStart(record: ZipRecord, local: Uint8Array): number {
    const view = new DataView(local.buffer, local.byteOffset, 30);
    if (view.getUint32(0, true) !== ZIP_LOCAL_ENTRY) {
        throw new Error('The zip directory points at a damaged entry');
    }
    return record.localOffset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
}

function readZip(zip: Uint8Array): ArchiveEntry[] {
    const end = endRecordIn(zip);
    const entries: ArchiveEntry[] = [];
    for (const record of zipRecords(zip.subarray(end.getUint32(16, true)), end.getUint16(10, true))) {
        if (record.name.endsWith('/')) {
            continue;
        }
        const start = dataStart(record, zip.subarray(record.localOffset, record.localOffset + 30));
        const stored = zip.subarray(start, start + record.compressedSize);
        requireMethod(record);
        entries.push({ path: record.name, data: record.method === 0 ? stored : inflateRawSync(stored), mode: record.mode });
    }
    return entries;
}

export function readArchive(bytes: Uint8Array, format: ArchiveFormat): ArchiveEntry[] {
    return format === 'zip' ? readZip(bytes) : readTar(gunzipSync(bytes));
}

/* A file is executable for everyone or for nobody, whatever else the archive's mode says. */
function executableMode(mode: number): number {
    return mode & 0o111 ? 0o755 : 0o644;
}

interface ExtractOptions {
    /* Leading folders to drop from every path, such as the one GitHub wraps a commit in. */
    strip?: number;
    /* Whether a file, by its path after the strip, is written. */
    keep?: (path: string) => boolean;
}

/* The path of an entry after the strip, or null for one that must not be written: absolute, climbing out with `..`, or not kept. */
function safeRelative(path: string, options: ExtractOptions): string | null {
    const parts = path.split('/').filter((part) => part !== '' && part !== '.');
    const relative = parts.slice(options.strip ?? 0).join('/');
    if (relative === '' || relative.includes('\0') || posix.isAbsolute(path) || parts.includes('..') || options.keep?.(relative) === false) {
        return null;
    }
    return relative;
}

/*
 * Writes the files of an archive under a folder and answers their paths after the strip. A path
 * that is absolute or climbs out with `..` is skipped, so an archive can never write outside the
 * folder it was given.
 */
export async function extractEntries(entries: readonly ArchiveEntry[], destination: string, options: ExtractOptions = {}): Promise<string[]> {
    const written: string[] = [];
    for (const entry of entries) {
        const relative = safeRelative(entry.path, options);
        if (relative === null) {
            continue;
        }
        const target = join(destination, relative);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, entry.data);
        await chmod(target, executableMode(entry.mode));
        written.push(relative);
    }
    return written;
}

// The end-of-directory record sits in the last 22 bytes plus a comment of at most 64 KiB.
const ZIP_TAIL = 22 + 0xffff;

/*
 * Unpacks a zip file from disk one entry at a time, each streamed through the inflater into its file, so
 * an archive of hundreds of megabytes never sits in memory whole. The same paths are skipped as by
 * `extractEntries`, and an archive that needs ZIP64 is refused.
 */
export async function extractZipFile(file: string, destination: string, options: ExtractOptions = {}): Promise<string[]> {
    const handle = await open(file, 'r');
    try {
        const size = (await handle.stat()).size;
        const tailLength = Math.min(size, ZIP_TAIL);
        const tail = Buffer.alloc(tailLength);
        await handle.read(tail, 0, tailLength, size - tailLength);
        const end = endRecordIn(tail);
        const directorySize = end.getUint32(12, true);
        const directoryOffset = end.getUint32(16, true);
        if (directoryOffset === ZIP64_MARKER || directorySize === ZIP64_MARKER) {
            throw new Error('The archive needs ZIP64, which is not supported');
        }
        const directory = Buffer.alloc(directorySize);
        await handle.read(directory, 0, directorySize, directoryOffset);
        const written: string[] = [];
        for (const record of zipRecords(directory, end.getUint16(10, true))) {
            if (record.compressedSize === ZIP64_MARKER || record.localOffset === ZIP64_MARKER) {
                throw new Error('The archive needs ZIP64, which is not supported');
            }
            const relative = record.name.endsWith('/') ? null : safeRelative(record.name, options);
            if (relative === null) {
                continue;
            }
            requireMethod(record);
            const local = Buffer.alloc(30);
            await handle.read(local, 0, 30, record.localOffset);
            const start = dataStart(record, local);
            const target = join(destination, relative);
            await mkdir(dirname(target), { recursive: true });
            const stored: Readable =
                record.compressedSize === 0 ? Readable.from([]) : createReadStream(file, { start, end: start + record.compressedSize - 1 });
            await (record.method === 0 ? pipeline(stored, createWriteStream(target)) : pipeline(stored, createInflateRaw(), createWriteStream(target)));
            await chmod(target, executableMode(record.mode));
            written.push(relative);
        }
        return written;
    } finally {
        await handle.close();
    }
}
