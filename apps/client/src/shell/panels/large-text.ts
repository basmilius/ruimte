import { BYTES_READ_MAX_BYTES, type FsReadResult, type FsReadText, type FsReadTooLarge } from '@ruimte/contracts';
import { readMachineFile } from '@/transport/machine-url';

// Over loopback or in pieces that never hold up a terminal, so only what a page holds in memory limits it.
export const TEXT_MAX_BYTES = BYTES_READ_MAX_BYTES;

/*
 * A text file past `fs.read`'s cap, fetched as bytes and decoded the way the daemon decodes one:
 * strict UTF-8, so a byte that is not makes the file binary rather than lossy text. `previous` is the
 * last text of this path read this way, kept while the file is unchanged, since a change anywhere in
 * its folder reads it again.
 */
export async function readLargeText(
    endpointId: string,
    path: string,
    read: FsReadTooLarge,
    previous: FsReadText | null,
    limit: number = TEXT_MAX_BYTES
): Promise<FsReadResult> {
    const { mtime, size } = read;
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
