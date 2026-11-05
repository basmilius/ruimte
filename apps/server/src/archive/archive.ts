import { basename } from 'node:path';
import { ARCHIVE_LIST_MAX_ENTRIES, BYTES_READ_MAX_BYTES, type ArchiveEntry, type ArchiveFormat, type ArchiveListResult } from '@ruimte/contracts';
import { looksLikeSvg, sniffMime } from '../disk/sniff.ts';
import { inspect, languageOf, looksBinary, SERVED_TEXT_MIME, SNIFF_BYTES } from '../fs/read.ts';
import { namesTop, safeEntryPath } from './entry-path.ts';
import { gunzipChunks, parseGzipHeader, plainChunks } from './gzip.ts';
import { ARCHIVE_SCAN_MAX_BYTES, ARCHIVE_SCAN_MAX_ENTRIES, ArchiveError, InflateMeter } from './limits.ts';
import { ChunkReader, collect, withFile, type RandomAccess } from './streams.ts';
import { isTarHeader, tarEntries, type TarKind } from './tar.ts';
import { readZipDirectory, zipEntryChunks, zipReadable } from './zip.ts';

export interface ArchiveFile {
    path: string;
    format: ArchiveFormat;
    size: number;
    mtime: number;
}

const TAR_BLOCK = 512;

/* Whether a gzip holds a tar: its first block, unpacked, is a tar header. A gzip too short for one holds a file. */
async function holdsTar(path: string): Promise<boolean> {
    const reader = new ChunkReader(gunzipChunks(path, new InflateMeter(ARCHIVE_SCAN_MAX_BYTES, () => new ArchiveError('too-large', 'Too large'))));
    try {
        const block = await reader.read(TAR_BLOCK);
        return block !== null && isTarHeader(block);
    } catch {
        return false;
    } finally {
        await reader.close();
    }
}

/* What kind of archive the file is, read from its bytes and never from its name. */
export async function openArchive(path: string): Promise<ArchiveFile> {
    const { file, mime } = await inspect(path);
    const found = { path: file.path, size: file.size, mtime: file.mtime };
    // A USDZ package is a zip by every other measure, and its entries are as readable as any.
    if (mime === 'application/zip' || mime === 'model/vnd.usdz+zip') {
        return { ...found, format: 'zip' };
    }
    if (mime === 'application/x-tar') {
        return { ...found, format: 'tar' };
    }
    if (mime === 'application/gzip') {
        return { ...found, format: (await holdsTar(file.path)) ? 'tar-gzip' : 'gzip' };
    }
    throw new ArchiveError('not-an-archive', `${basename(file.path)} is not a zip, a tar or a gzip`);
}

export interface WalkedEntry {
    /* Null when the name could land outside the folder it is extracted into. */
    path: string | null;
    raw: string;
    kind: TarKind;
    readable: boolean;
    size: number;
    compressedSize?: number;
    mtime: number | null;
    mode: number | null;
    /* The entry's bytes; only valid while the visit that was handed the entry runs. */
    chunks(): AsyncGenerator<Uint8Array>;
}

interface WalkLimits {
    /* What one inflater may put out; a zip counts per entry, a compressed tar over the whole stream. */
    maxBytes: number;
    tooLarge(): Error;
}

/* A visit answers true when it has what it came for, which ends the walk. */
type Visit = (entry: WalkedEntry) => Promise<boolean | void>;

function meterOf(limits: WalkLimits): InflateMeter {
    return new InflateMeter(limits.maxBytes, limits.tooLarge);
}

function tooManyEntries(): ArchiveError {
    return new ArchiveError('too-many-entries', `This archive holds more than ${ARCHIVE_SCAN_MAX_ENTRIES} entries`);
}

function gzipName(archivePath: string, recorded: string | null): string {
    // The header may keep a whole path; only the file's own name is of use here.
    const name = recorded === null ? null : safeEntryPath(recorded.split(/[/\\]/).pop() ?? '');
    if (name !== null) {
        return name;
    }
    const own = basename(archivePath).replace(/\.t?gz$/i, (suffix) => (suffix.toLowerCase() === '.tgz' ? '.tar' : ''));
    return safeEntryPath(own) ?? 'data';
}

async function walkZip(archive: ArchiveFile, limits: WalkLimits, visit: Visit): Promise<void> {
    await withFile(archive.path, async (file) => {
        const { entries, truncated } = await readZipDirectory(file);
        for (const entry of entries) {
            if (namesTop(entry.name)) {
                continue;
            }
            const kind: TarKind = entry.symlink ? 'symlink' : entry.directory ? 'directory' : 'file';
            const stop = await visit({
                path: safeEntryPath(entry.name),
                raw: entry.name,
                kind,
                readable: kind === 'directory' || (kind === 'file' && zipReadable(entry)),
                size: kind === 'file' ? entry.size : 0,
                compressedSize: entry.compressedSize,
                mtime: entry.mtime,
                mode: entry.mode,
                chunks: () => zipEntryChunks(file, entry, meterOf(limits))
            });
            if (stop === true) {
                return;
            }
        }
        if (truncated) {
            throw tooManyEntries();
        }
    });
}

async function walkTar(archive: ArchiveFile, limits: WalkLimits, visit: Visit): Promise<void> {
    const meter = meterOf(limits);
    const reader = new ChunkReader(archive.format === 'tar' ? plainChunks(archive.path, meter) : gunzipChunks(archive.path, meter));
    try {
        let count = 0;
        for await (const { header, body } of tarEntries(reader)) {
            if (++count > ARCHIVE_SCAN_MAX_ENTRIES) {
                throw tooManyEntries();
            }
            if (namesTop(header.name)) {
                continue;
            }
            const stop = await visit({
                path: safeEntryPath(header.name),
                raw: header.name,
                kind: header.kind,
                readable: header.readable && (header.kind === 'file' || header.kind === 'directory'),
                size: header.size,
                mtime: header.mtime,
                mode: header.mode,
                chunks: body
            });
            if (stop === true) {
                return;
            }
        }
    } finally {
        await reader.close();
    }
}

/* The size the trailer of the last member claims, modulo 4 GiB as the format keeps it; shown, never trusted. */
async function gzipTrailerSize(file: RandomAccess): Promise<number> {
    if (file.size < 18) {
        throw new ArchiveError('corrupt', 'This gzip is shorter than its own header and trailer');
    }
    const tail = await file.read(file.size - 4, 4);
    return new DataView(tail.buffer, tail.byteOffset, 4).getUint32(0, true);
}

async function walkGzip(archive: ArchiveFile, limits: WalkLimits, visit: Visit): Promise<void> {
    const { header, size } = await withFile(archive.path, async (file) => ({
        header: parseGzipHeader(await file.read(0, 64 * 1024)),
        size: await gzipTrailerSize(file)
    }));
    if (header === null) {
        throw new ArchiveError('corrupt', 'This gzip has no header');
    }
    const name = gzipName(archive.path, header.name);
    await visit({
        path: name,
        raw: name,
        kind: 'file',
        readable: true,
        size,
        compressedSize: archive.size,
        mtime: header.mtime,
        mode: null,
        chunks: () => gunzipChunks(archive.path, meterOf(limits))
    });
}

/* Every entry of the archive in its own order, until the visit has what it came for. */
export function walkArchive(archive: ArchiveFile, limits: WalkLimits, visit: Visit): Promise<void> {
    if (archive.format === 'zip') {
        return walkZip(archive, limits, visit);
    }
    if (archive.format === 'gzip') {
        return walkGzip(archive, limits, visit);
    }
    return walkTar(archive, limits, visit);
}

/* The listing of a compressed tar used up what it may unpack; what it has so far is the answer. */
class ScanBudgetSpent extends Error {}

/*
 * The entries a person sees, up to `ARCHIVE_LIST_MAX_ENTRIES`. A name that could escape is counted and
 * left out, the second of two entries with one path is left out, and devices and FIFOs are never listed.
 * Listing a compressed tar unpacks it, so its walk also ends as truncated at `ARCHIVE_SCAN_MAX_BYTES`.
 */
export async function listArchive(path: string): Promise<ArchiveListResult> {
    const archive = await openArchive(path);
    const entries: ArchiveEntry[] = [];
    const seen = new Set<string>();
    let unsafe = 0;
    let truncated = false;
    await walkArchive(archive, { maxBytes: ARCHIVE_SCAN_MAX_BYTES, tooLarge: () => new ScanBudgetSpent() }, async (entry) => {
        if (entry.kind === 'other') {
            return false;
        }
        if (entry.path === null) {
            unsafe++;
            return false;
        }
        if (seen.has(entry.path)) {
            return false;
        }
        if (entries.length >= ARCHIVE_LIST_MAX_ENTRIES) {
            truncated = true;
            return true;
        }
        seen.add(entry.path);
        entries.push({
            path: entry.path,
            kind: entry.kind === 'hardlink' ? 'file' : entry.kind,
            size: entry.size,
            ...(entry.compressedSize === undefined ? {} : { compressedSize: entry.compressedSize }),
            ...(entry.mtime === null ? {} : { mtime: entry.mtime }),
            readable: entry.readable
        });
        return false;
    }).catch((e: unknown) => {
        if (!(e instanceof ScanBudgetSpent)) {
            throw e;
        }
        truncated = true;
    });
    return { format: archive.format, entries, truncated, unsafe };
}

interface ArchiveEntryBytes {
    bytes: Uint8Array;
    mime: string;
    language?: string;
    /* The archive's mtime and size, which pin every piece to one version of it. */
    version: string;
}

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

function isUtf8(bytes: Uint8Array): boolean {
    try {
        STRICT_UTF8.decode(bytes);
        return true;
    } catch {
        return false;
    }
}

/* What an entry's own bytes claim, the way `inspect` reads a file: a known format, text, or a binary nothing draws. */
function entryMime(bytes: Uint8Array): string {
    const head = bytes.subarray(0, SNIFF_BYTES);
    const magic = sniffMime(head, bytes.length);
    if (magic !== null) {
        return magic;
    }
    if (looksBinary(head, bytes.length > SNIFF_BYTES) || !isUtf8(bytes)) {
        return 'application/octet-stream';
    }
    return looksLikeSvg(head) ? 'image/svg+xml' : SERVED_TEXT_MIME;
}

function entryTooLarge(entry: string): ArchiveError {
    return new ArchiveError('entry-too-large', `${entry} is larger than an entry this machine hands out whole`);
}

async function readEntry(archive: ArchiveFile, entry: string): Promise<Uint8Array> {
    const found: { bytes: Uint8Array | null } = { bytes: null };
    // A tar meters its whole stream, so the walk gets the scan's budget and `collect` bounds the entry itself.
    const tooLarge = (): Error => new ArchiveError('too-large', `${entry} lies further into this archive than this machine unpacks`);
    await walkArchive(archive, { maxBytes: ARCHIVE_SCAN_MAX_BYTES, tooLarge }, async (walked) => {
        if (walked.path !== entry) {
            return false;
        }
        if (walked.kind !== 'file') {
            throw new ArchiveError('not-readable', walked.kind === 'directory' ? `${entry} is a folder` : `${entry} is a link, which is never followed`);
        }
        if (!walked.readable) {
            throw new ArchiveError('not-readable', `${entry} is encrypted or packed in a way this machine does not unpack`);
        }
        if (walked.size > BYTES_READ_MAX_BYTES) {
            throw entryTooLarge(entry);
        }
        found.bytes = await collect(walked.chunks(), BYTES_READ_MAX_BYTES, () => entryTooLarge(entry));
        return true;
    });
    if (found.bytes === null) {
        throw new ArchiveError('entry-not-found', `${entry} is not in this archive`);
    }
    return found.bytes;
}

// Two entries, so a preview and the save of another one do not unpack each other over and over.
const CACHED_ENTRIES = 2;
const cache = new Map<string, Promise<ArchiveEntryBytes>>();

/*
 * One entry whole, for `bytes.read`. A client asks for it a piece at a time, and a compressed entry cannot
 * be entered halfway, so the last few unpacked entries are kept until another takes their place.
 */
export async function readArchiveEntry(path: string, entry: string): Promise<ArchiveEntryBytes> {
    const archive = await openArchive(path);
    const version = `${archive.mtime}-${archive.size}`;
    const key = JSON.stringify([archive.path, version, entry]);
    let pending = cache.get(key);
    if (pending === undefined) {
        pending = readEntry(archive, entry).then((bytes) => {
            const mime = entryMime(bytes);
            const language = mime === SERVED_TEXT_MIME ? languageOf(basename(entry)) : undefined;
            return { bytes, mime, version, ...(language === undefined ? {} : { language }) };
        });
        pending.catch(() => cache.delete(key));
    } else {
        cache.delete(key);
    }
    cache.set(key, pending);
    while (cache.size > CACHED_ENTRIES) {
        cache.delete(cache.keys().next().value!);
    }
    return pending;
}
