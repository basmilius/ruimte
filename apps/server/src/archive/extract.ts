import { constants } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { CodedError } from '@adecore/agents';
import { ARCHIVE_SKIPPED_MAX, type ArchiveExtractResult, type ArchiveSkipped } from '@ruimte/contracts';
import { bestEffort } from '../best-effort.ts';
import { deepestExisting } from '../fs/create.ts';
import { assertOpenGround, realRoots, rootOf, stateRefusal, type WriteBoundary } from '../fs/write.ts';
import { openArchive, walkArchive, type WalkedEntry } from './archive.ts';
import { safeEntryPath, selects } from './entry-path.ts';
import { ARCHIVE_EXTRACT_MAX_BYTES, ArchiveError } from './limits.ts';

export interface ExtractRequest {
    path: string;
    /* Absent, the whole archive. */
    entries?: readonly string[];
    to: string;
}

function tooLarge(): ArchiveError {
    return new ArchiveError('too-large', `An extract writes at most ${ARCHIVE_EXTRACT_MAX_BYTES / 1024 / 1024 / 1024} GiB, and this one unpacks to more`);
}

type Placement = { write: string } | { skip: string };

/*
 * Unpacks into a folder of an open project. Where everything lands is judged on real paths before a byte
 * is written: `to` has to be inside a project or one of its worktrees, `.git` and `.ruimte` stay closed at
 * any level, and a file already there is refused as `exists` rather than written over. Links of either
 * kind are never made, only reported as skipped. Every file is made with `O_EXCL`, and every folder an
 * entry lands in is checked to still lead inside `to` once it exists, so nothing an archive or a race
 * puts in the way carries a write out of it.
 */
export async function planExtract(request: ExtractRequest, boundary: WriteBoundary): Promise<{ to: string; run(): Promise<ArchiveExtractResult> }> {
    if (!isAbsolute(request.to) || request.to.includes('\0')) {
        throw new ArchiveError('bad-path', 'The folder to extract into must be an absolute path');
    }
    const target = resolve(request.to);
    const there = await lstat(target).catch(() => null);
    if (there !== null && !there.isDirectory()) {
        throw new ArchiveError('not-a-directory', `${target} is already there and is not a folder`);
    }
    const { base, missing } = await deepestExisting(target);
    const realTo = join(base, ...missing);
    const roots = await realRoots(boundary);
    let root: string;

    try {
        root = rootOf(roots, realTo, target);
        assertOpenGround(root, realTo, target, 'written');
    } catch (e) {
        throw e instanceof CodedError ? new ArchiveError(e.code, e.message) : e;
    }

    const selection = request.entries?.map((entry) => {
        const safe = safeEntryPath(entry);
        if (safe === null) {
            throw new ArchiveError('bad-path', `${entry} is not a name an entry of an archive can have`);
        }
        return safe;
    });
    const archive = await openArchive(request.path);
    const placed = new Set<string>();

    /* Where an entry goes, or why it does not. Called once per entry in the archive's order, so the first of two with one path is the one written. */
    const place = (entry: WalkedEntry): Placement | null => {
        if (entry.kind === 'other') {
            return null;
        }
        if (entry.path === null) {
            return selection === undefined ? { skip: 'unsafe-name' } : null;
        }
        const path = entry.path;
        if (selection !== undefined && !selection.some((selected) => selects(selected, path))) {
            return null;
        }
        if (placed.has(path)) {
            return { skip: 'duplicate' };
        }
        placed.add(path);
        if (entry.kind === 'symlink' || entry.kind === 'hardlink') {
            return { skip: 'link' };
        }
        if (!entry.readable) {
            return { skip: 'unreadable' };
        }
        const destination = join(realTo, ...path.split('/'));
        if (stateRefusal(relative(root, destination).split(sep), destination, 'written') !== null) {
            return { skip: 'closed' };
        }
        return { write: destination };
    };

    // Only a folder that is there can hold a file of the same name, so a new one needs no look first.
    if (there !== null) {
        await walkArchive(archive, { maxBytes: ARCHIVE_EXTRACT_MAX_BYTES, tooLarge }, async (entry) => {
            const placement = place(entry);
            if (placement === null || !('write' in placement)) {
                return;
            }
            const taken = await lstat(placement.write).catch(() => null);
            if (taken !== null && (entry.kind === 'file' || !taken.isDirectory())) {
                throw new ArchiveError('exists', `${placement.write} is already there`);
            }
        });
        placed.clear();
    }

    return {
        to: target,
        run: async () => {
            const result: ArchiveExtractResult = { to: target, files: 0, directories: 0, bytes: 0, skipped: [], skippedTotal: 0 };
            const inside = new Set<string>();
            let matched = false;

            /* Makes the folder one level at a time from `to` down, and refuses a level that is a link rather than follow it. */
            const folder = async (path: string): Promise<void> => {
                if (inside.has(path)) {
                    return;
                }
                if (path === realTo) {
                    await mkdir(realTo, { recursive: true });
                    inside.add(path);
                    return;
                }
                await folder(dirname(path));
                await mkdir(path).catch((e: unknown) => {
                    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
                        throw e;
                    }
                });
                const made = await lstat(path);
                if (made.isSymbolicLink()) {
                    throw new ArchiveError('outside-project', `${path} is a link, and an extract never follows one out of its folder`);
                }
                if (!made.isDirectory()) {
                    throw new ArchiveError('exists', `${path} is already there and is not a folder`);
                }
                inside.add(path);
            };

            const skip = (entry: WalkedEntry, reason: string): void => {
                result.skippedTotal++;
                if (result.skipped.length < ARCHIVE_SKIPPED_MAX) {
                    result.skipped.push({ path: entry.path ?? entry.raw, reason } satisfies ArchiveSkipped);
                }
            };

            const writeFile = async (entry: WalkedEntry, destination: string): Promise<void> => {
                await folder(dirname(destination));
                const mode = ((entry.mode ?? 0) & 0o111) !== 0 ? 0o755 : 0o644;
                const handle = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode).catch(
                    (e: unknown) => {
                        if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
                            throw new ArchiveError('exists', `${destination} is already there`);
                        }
                        throw e;
                    }
                );
                try {
                    for await (const chunk of entry.chunks()) {
                        result.bytes += chunk.length;
                        if (result.bytes > ARCHIVE_EXTRACT_MAX_BYTES) {
                            throw tooLarge();
                        }
                        await handle.write(chunk);
                    }
                    if (entry.mtime !== null) {
                        await handle.utimes(new Date(), new Date(entry.mtime));
                    }
                } catch (e) {
                    await handle.close();
                    // Half a file is worse than none: what was written whole before it stays.
                    await bestEffort('unlink', unlink(destination));
                    throw e;
                }
                await handle.close();
            };

            await walkArchive(archive, { maxBytes: ARCHIVE_EXTRACT_MAX_BYTES, tooLarge }, async (entry) => {
                const placement = place(entry);
                if (placement === null) {
                    return;
                }
                matched = true;
                if ('skip' in placement) {
                    skip(entry, placement.skip);
                    return;
                }
                if (entry.kind === 'directory') {
                    await folder(placement.write);
                    result.directories++;
                    return;
                }
                await writeFile(entry, placement.write);
                result.files++;
            });
            if (selection !== undefined && !matched) {
                throw new ArchiveError('entry-not-found', 'None of those entries is in this archive');
            }
            await folder(realTo);
            return result;
        }
    };
}
