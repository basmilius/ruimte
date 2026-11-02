import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { ARTIFACT_LIMITS } from '@ruimte/contracts';
import type { Artifacts } from '../artifacts/artifacts.ts';
import { VerbRefusal } from '../canvas/verb.ts';
import { AGENT_IMAGE_BYTES, AGENT_MODEL_BYTES, agentAttachmentBytes, agentAttachmentType } from '../chat/attachment-type.ts';
import type { AgentFiles } from './files.ts';
import { readAtMost } from './visual-images.ts';

const MIB = 1024 * 1024;

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type ArtifactUploads = Pick<Artifacts, 'uploadState' | 'uploadAppend'>;

/*
 * Stages the files an `artifact_publish` names under an upload of the caller's own, read here in pieces
 * from the folders its files may come from, and answers the flags `artifact publish` turns into a version.
 * An upload already partly there goes on where it stopped, so the same request id resumes.
 */
export async function stageArtifact(
    uploads: ArtifactUploads,
    files: AgentFiles,
    caller: string,
    paths: readonly string[],
    requestId: string | undefined
): Promise<string[]> {
    if (paths.length === 0) {
        throw new VerbRefusal('bad-arguments', 'artifact_publish needs paths, one per file');
    }

    if (paths.length > ARTIFACT_LIMITS.filesPerVersion) {
        throw new VerbRefusal('too-large', `${paths.length} files were named and a version holds at most ${ARTIFACT_LIMITS.filesPerVersion}`);
    }

    const real = await Promise.all(paths.map((path) => files.file(path)));
    const sizes = await Promise.all(real.map(async (path) => (await stat(path)).size));

    if (sizes.reduce((sum, size) => sum + size, 0) > ARTIFACT_LIMITS.versionBytes) {
        throw new VerbRefusal('too-large', 'These files are more than the 2 GiB a version holds together');
    }

    const request = requestId ?? `p${randomUUID().replaceAll('-', '')}`;

    if (!REQUEST_ID.test(request)) {
        throw new VerbRefusal('bad-arguments', 'request_id is 1 to 64 letters, digits, dashes and underscores');
    }

    const state = await uploads.uploadState(caller, request, request);

    if (state.done === null) {
        for (const [index, path] of real.entries()) {
            const size = sizes[index]!;
            const sent = state.sizes[index];

            if (sent !== undefined && sent > size) {
                throw new VerbRefusal(
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

    return [`--request-id=${request}`, `--upload=${request}`, `--files=${JSON.stringify(named)}`];
}

/* The flags `chat attach` takes for an image or a model file of the caller's own: its name and its bytes, checked as the CLI checked them. */
export async function attachmentFlags(files: AgentFiles, path: string, name: string | undefined): Promise<string[]> {
    const real = await files.file(path);
    const buffer = Buffer.alloc(AGENT_MODEL_BYTES + 1);
    const length = await readAtMost(real, buffer);

    if (length > AGENT_MODEL_BYTES) {
        throw new VerbRefusal(
            'attach-too-large',
            `${path} is more than the ${AGENT_MODEL_BYTES / MIB} MiB a model may be, and an image ${AGENT_IMAGE_BYTES / MIB} MiB`
        );
    }

    const bytes = buffer.subarray(0, length);
    const type = agentAttachmentType(bytes);

    if (type === null) {
        throw new VerbRefusal(
            'attach-not-image',
            `${path} is no image or model: its bytes are not a PNG, JPEG, GIF, WebP, HEIC or HEIF, nor a binary glTF, USDZ or STL`
        );
    }

    if (length > agentAttachmentBytes(type.kind)) {
        throw new VerbRefusal('attach-too-large', `${path} is more than the ${AGENT_IMAGE_BYTES / MIB} MiB an image may be`);
    }

    return [`--name=${name ?? basename(path)}`, `--data=${bytes.toString('base64')}`];
}
