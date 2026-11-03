import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { ARTIFACT_LIMITS } from '@ruimte/contracts';
import { ToolRefusal } from '@adecore/agents/context';
import type { Artifacts } from '../artifacts/artifacts.ts';
import type { AgentFiles } from './files.ts';

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type ArtifactUploads = Pick<Artifacts, 'uploadState' | 'uploadAppend'>;

/* The upload a publish names: its request id, the upload the bytes went under, and each file's name and size. */
export interface StagedArtifact {
    requestId: string;
    upload: string;
    files: { name: string; size: number }[];
}

/*
 * Stages the files an `artifact_publish` names under an upload of the caller's own, read here in pieces
 * from the folders its files may come from, and answers what `artifact.publish` turns into a version.
 * An upload already partly there goes on where it stopped, so the same request id resumes.
 */
export async function stageArtifact(
    uploads: ArtifactUploads,
    files: AgentFiles,
    caller: string,
    paths: readonly string[],
    requestId: string | undefined
): Promise<StagedArtifact> {
    if (paths.length === 0) {
        throw new ToolRefusal('bad-arguments', 'artifact_publish needs paths, one per file');
    }

    if (paths.length > ARTIFACT_LIMITS.filesPerVersion) {
        throw new ToolRefusal('too-large', `${paths.length} files were named and a version holds at most ${ARTIFACT_LIMITS.filesPerVersion}`);
    }

    const real = await Promise.all(paths.map((path) => files.file(path)));
    const sizes = await Promise.all(real.map(async (path) => (await stat(path)).size));

    if (sizes.reduce((sum, size) => sum + size, 0) > ARTIFACT_LIMITS.versionBytes) {
        throw new ToolRefusal('too-large', 'These files are more than the 2 GiB a version holds together');
    }

    const request = requestId ?? `p${randomUUID().replaceAll('-', '')}`;

    if (!REQUEST_ID.test(request)) {
        throw new ToolRefusal('bad-arguments', 'request_id is 1 to 64 letters, digits, dashes and underscores');
    }

    const state = await uploads.uploadState(caller, request, request);

    if (state.done === null) {
        for (const [index, path] of real.entries()) {
            const size = sizes[index]!;
            const sent = state.sizes[index];

            if (sent !== undefined && sent > size) {
                throw new ToolRefusal(
                    'upload-mismatch',
                    `${paths[index]} is shorter than what an earlier call under this request id sent; publish it under another request_id`
                );
            }

            if (sent === size) {
                continue;
            }

            let offset = sent ?? 0;

            // At least one piece, so an empty file arrives too.
            do {
                const piece = new Uint8Array(
                    await Bun.file(path)
                        .slice(offset, Math.min(offset + ARTIFACT_LIMITS.uploadChunkBytes, size))
                        .arrayBuffer()
                );
                offset = await uploads.uploadAppend(caller, request, index, offset, piece);
            } while (offset < size);
        }
    }

    const named = paths.map((path, index) => ({ name: basename(path), size: sizes[index]! }));

    return { requestId: request, upload: request, files: named };
}
