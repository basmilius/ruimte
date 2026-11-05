import type { ByteResource } from '@ruimte/contracts';
import { useEndpointId } from '@/state/current-endpoint';
import { readPiece } from '@/transport-api/piece';
import { readResource } from '@/transport/byte-transfer';
import { machineTransport } from '@/transport/index';
import { readMachineFile, type MachineResource } from '@/transport/machine-url';

/*
 * Where the bytes a binary renderer draws come from: a file on the machine, one entry of an archive
 * there, or a file of a saved version of Output. Only a file is a path: an entry and an Output file
 * are read only, nothing about them can be revealed, renamed or saved over, and an Output file is
 * read by its artifact and version id alone, on the machine that keeps it.
 */
export type FileSource =
    | { kind: 'file'; path: string }
    | { kind: 'archive-entry'; path: string; entry: string; archiveMtime: number; archiveSize: number }
    | { kind: 'artifact'; endpointId: string; artifactId: string; versionId: string; file: number };

export function fileSource(path: string): FileSource {
    return { kind: 'file', path };
}

/* The machine a source is read from: an Output file names its own, since another machine of the account may keep it. */
export function useEndpointIdOf(source: FileSource): string {
    const own = useEndpointId();
    return source.kind === 'artifact' ? source.endpointId : own;
}

/* The machine's bytes for this source. `media` asks for ranges, which only a file has: an entry or an Output file comes whole. */
export function machineResourceOf(source: FileSource, read: { mtime: number; size: number; mime?: string }, media = false): MachineResource {
    if (source.kind === 'artifact') {
        return { kind: 'artifact', artifactId: source.artifactId, versionId: source.versionId, file: source.file };
    }
    if (source.kind === 'archive-entry') {
        return { kind: 'archive-entry', path: source.path, entry: source.entry, mtime: source.archiveMtime, size: source.archiveSize };
    }
    return { kind: media ? 'media' : 'file', path: source.path, mtime: read.mtime, size: read.size, mime: read.mime };
}

/* What a file manager can be asked to show, which an entry inside an archive or an Output file is not. */
export function revealablePath(source: FileSource): string | null {
    return source.kind === 'file' ? source.path : null;
}

/* One string per source and version, for a key or a reset that has to follow both. */
export function sourceKey(source: FileSource, read: { mtime: number; size: number }): string {
    if (source.kind === 'artifact') {
        return JSON.stringify([source.endpointId, source.artifactId, source.versionId, source.file]);
    }
    return JSON.stringify(source.kind === 'file' ? [source.path, read.mtime, read.size] : [source.path, source.entry, source.archiveMtime, source.archiveSize]);
}

/* What a whole read of a source asks the machine for, without the version that only pins a cache. */
export function wireResourceOf(source: FileSource): ByteResource {
    if (source.kind === 'artifact') {
        return { kind: 'artifact', artifactId: source.artifactId, versionId: source.versionId, file: source.file };
    }
    return source.kind === 'file' ? { kind: 'file', path: source.path } : { kind: 'file', path: source.path, entry: source.entry };
}

/* A source's bytes whole, for a renderer that reads them rather than draws them from a URL. */
export async function readSourceBytes(endpointId: string, source: FileSource, read: { mtime: number; size: number }, maxBytes: number): Promise<ArrayBuffer> {
    if (source.kind === 'artifact') {
        const transport = machineTransport(endpointId);
        const blob = await readResource((piece) => readPiece(transport, piece), wireResourceOf(source), { maxBytes });
        return blob.arrayBuffer();
    }
    const file =
        source.kind === 'file'
            ? { path: source.path, mtime: read.mtime, size: read.size }
            : { path: source.path, mtime: source.archiveMtime, size: source.archiveSize, entry: source.entry };
    return readMachineFile(endpointId, file, maxBytes);
}
