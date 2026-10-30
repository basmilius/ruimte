import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactFile } from '@ruimte/contracts';
import { isNotFound } from '@adecore/agents';
import { isDiskFull } from './artifact-fs.ts';
import { ArtifactError, relativeSegments } from './artifact-names.ts';

interface CopySource {
    file: ArtifactFile;
    /* Where the store keeps its bytes. */
    path: string;
}

function isExists(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && e.code === 'EEXIST';
}

const EXISTS = 'That name exists in the project already. Ruimte never overwrites a file.';

/* Each folder below the project folder on the way to a file, made when it is missing and refused when it is a link. */
async function ensureFolders(folder: string, segments: readonly string[], made: string[]): Promise<void> {
    let current = folder;
    for (const segment of segments) {
        current = join(current, segment);
        let info = await lstat(current).catch((e: unknown) => (isNotFound(e) ? null : Promise.reject(e)));
        if (info === null) {
            const created = await mkdir(current).then(
                () => true,
                (e: unknown) => (isExists(e) ? false : Promise.reject(e))
            );
            if (created) {
                made.push(current);
            }
            info = await lstat(current);
        }
        if (info.isSymbolicLink()) {
            throw new ArtifactError('symlink', 'A folder on the way is a link; a copy only goes into real folders of the project');
        }
        if (!info.isDirectory()) {
            throw new ArtifactError('bad-path', 'A part of the path is a file, not a folder');
        }
    }
}

/* Writes a file that must not be there yet: `wx` refuses an existing name and a link in the same call that makes it. */
async function writeNew(target: string, from: string): Promise<void> {
    // On Windows `wx` writes through a link whose target is not there.
    if (
        await lstat(target).then(
            () => true,
            () => false
        )
    ) {
        throw new ArtifactError('exists', EXISTS);
    }
    const handle = await open(target, 'wx', 0o644).catch((e: unknown) => {
        throw isExists(e) ? new ArtifactError('exists', EXISTS) : e;
    });
    try {
        for await (const chunk of createReadStream(from)) {
            await handle.write(chunk as Uint8Array);
        }
        await handle.sync();
    } finally {
        await handle.close();
    }
}

/*
 * Copies a version into a project folder at a path relative to it: one file at that path, several
 * in a new folder of that name, each under its own name. Nothing that is there is replaced, no link
 * is followed, and a copy that fails takes back what it wrote. Answers the paths it wrote, relative.
 */
export async function copyVersionInto(folder: string, path: string, sources: readonly CopySource[]): Promise<string[]> {
    const segments = relativeSegments(path);
    const targets: Array<{ segments: string[]; from: string }> =
        sources.length === 1
            ? [{ segments, from: sources[0]!.path }]
            : sources.map((source) => ({ segments: [...segments, ...relativeSegments(source.file.name)], from: source.path }));
    const made: string[] = [];
    try {
        if (sources.length > 1) {
            await ensureFolders(folder, segments.slice(0, -1), made);
            const target = join(folder, ...segments);
            await mkdir(target).catch((e: unknown) => {
                throw isExists(e) ? new ArtifactError('exists', EXISTS) : e;
            });
            made.push(target);
        }
        for (const target of targets) {
            await ensureFolders(folder, target.segments.slice(0, -1), made);
            const file = join(folder, ...target.segments);
            await writeNew(file, target.from);
            made.push(file);
        }
    } catch (e) {
        // Newest first, so a folder this made is empty by the time it goes; one that is not stays.
        for (const written of made.reverse()) {
            await rm(written, { force: true }).catch(() => rmdir(written).catch(() => undefined));
        }
        if (isDiskFull(e)) {
            throw new ArtifactError('disk-full', 'The disk is full; nothing was copied');
        }
        throw e;
    }
    return sources.length === 1 ? [segments.join('/')] : [segments.join('/'), ...targets.map((target) => target.segments.join('/'))];
}
