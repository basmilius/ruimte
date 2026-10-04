import { BYTES_READ_MAX_BYTES, FS_READ_MAX_TEXT_BYTES, type FsReadResult, type FsReadText, type FsReadTooLarge } from '@ruimte/contracts';
import { endpointById } from '@/state/endpoints';
import { readMachineFile } from '@/transport/machine-url';

// A file on this machine comes over loopback HTTP, so only what a page holds in memory limits it.
const LOCAL_TEXT_MAX_BYTES = BYTES_READ_MAX_BYTES;

// Another machine's file comes in pieces that never hold up a terminal, but over a slow line every megabyte is a wait.
const REMOTE_TEXT_MAX_BYTES = 8 * 1024 * 1024;

/* The largest text file this client opens from a machine. A daemon that leaves `mtime` off serves no text as bytes, so its own cap is the limit. */
export function textLimitFor(endpointId: string, read: FsReadTooLarge): number {
    if (read.mtime === undefined) {
        return FS_READ_MAX_TEXT_BYTES;
    }
    return endpointById(endpointId)?.reachability === 'loopback' ? LOCAL_TEXT_MAX_BYTES : REMOTE_TEXT_MAX_BYTES;
}

/*
 * A text file past `fs.read`'s cap, fetched as bytes and decoded the way the daemon decodes one:
 * strict UTF-8, so a byte that is not makes the file binary rather than lossy text. `previous` is the
 * last text of this path read this way, kept while the file is unchanged, since a change anywhere in
 * its folder reads it again.
 */
export async function readLargeText(endpointId: string, path: string, read: FsReadTooLarge, previous: FsReadText | null): Promise<FsReadResult> {
    const { mtime, size } = read;
    const limit = textLimitFor(endpointId, read);
    if (mtime === undefined || size > limit) {
        return read;
    }
    if (previous !== null && previous.mtime === mtime && previous.size === size) {
        return previous;
    }
    const bytes = await readMachineFile(endpointId, { path, mtime, size }, limit);
    try {
        return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8', size, mtime };
    } catch {
        return { kind: 'binary', mime: 'application/octet-stream', size, mtime };
    }
}
