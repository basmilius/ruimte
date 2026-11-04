import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { ToolRefusal } from '@adecore/agents/context';
import { ARTIFACT_LIMITS } from '@ruimte/contracts';
import type { Artifacts } from '../artifacts/artifacts.ts';
import { readOpened, type AgentFiles, type OpenedFile } from './files.ts';

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

    const request = requestId ?? `p${randomUUID().replaceAll('-', '')}`;

    if (!REQUEST_ID.test(request)) {
        throw new ToolRefusal('bad-arguments', 'request_id is 1 to 64 letters, digits, dashes and underscores');
    }

    const opened: OpenedFile[] = [];

    try {
        for (const path of paths) {
            opened.push(await files.open(path));
        }

        const sizes = opened.map((file) => file.size);

        if (sizes.reduce((sum, size) => sum + size, 0) > ARTIFACT_LIMITS.versionBytes) {
            throw new ToolRefusal('too-large', 'These files are more than the 2 GiB a version holds together');
        }

        const state = await uploads.uploadState(caller, request, request);

        if (state.done === null) {
            for (const [index, file] of opened.entries()) {
                await sendFile(uploads, caller, request, index, file, state.sizes[index], paths[index]!);
            }
        }

        const named = paths.map((path, index) => ({ name: basename(path), size: sizes[index]! }));

        return { requestId: request, upload: request, files: named };
    } finally {
        await Promise.all(opened.map((file) => file.handle.close()));
    }
}

/* Sends what an earlier call under the request id did not, from the handle the file was judged on. */
async function sendFile(
    uploads: ArtifactUploads,
    caller: string,
    request: string,
    index: number,
    file: OpenedFile,
    sent: number | undefined,
    path: string
): Promise<void> {
    const { size, handle } = file;

    if (sent !== undefined && sent > size) {
        throw new ToolRefusal(
            'upload-mismatch',
            `${path} is shorter than what an earlier call under this request id sent; publish it under another request_id`
        );
    }

    if (sent === size) {
        return;
    }

    const changed = () => new ToolRefusal('file-changed', `${path} changed while it was sent; publish it again once nothing writes to it`);
    let offset = sent ?? 0;

    // At least one piece, so an empty file arrives too.
    do {
        const piece = Buffer.alloc(Math.min(ARTIFACT_LIMITS.uploadChunkBytes, size - offset));
        const length = await readOpened(handle, piece, offset);

        if (length < piece.length) {
            throw changed();
        }

        const next = await uploads.uploadAppend(caller, request, index, offset, piece);

        if (next !== offset + length) {
            throw changed();
        }

        offset = next;
    } while (offset < size);
}
