import {
    BYTES_READ_MAX_BYTES,
    isAudioMime,
    isImageMime,
    isModelMime,
    isPdfMime,
    isVideoMime,
    type ArtifactFile,
    type ArtifactVersion,
    type FsReadBinary
} from '@ruimte/contracts';
import type { ArtifactFileRef } from '@/output/artifact-bytes';
import { extensionOf, isHtmlName, isMarkdownName } from '@/surface/panels/file-kind';
import type { FileSource } from '@/surface/panels/file-source';

/*
 * How a file of a version is drawn, decided by what the file is and never by the artifact's kind: an
 * agent names the kind, the machine sniffed the type. What the files panel can show, a version shows.
 */
type ArtifactFileView = 'page' | 'markdown' | 'code' | 'image' | 'video' | 'audio' | 'pdf' | 'model' | 'none';

// The text types the machine names from a file's extension once its bytes read as UTF-8 (`artifact-names.ts`).
const TEXT_MIMES = new Set(['application/json', 'application/xml', 'application/yaml']);

function readsAsText(mime: string): boolean {
    return mime.startsWith('text/') || TEXT_MIMES.has(mime);
}

export function fileViewOf(file: Pick<ArtifactFile, 'name' | 'mime' | 'size'>): ArtifactFileView {
    if (isImageMime(file.mime)) {
        return 'image';
    }
    if (isVideoMime(file.mime)) {
        return 'video';
    }
    if (isAudioMime(file.mime)) {
        return 'audio';
    }
    if (isPdfMime(file.mime)) {
        return 'pdf';
    }
    if (isModelMime(file.mime)) {
        return 'model';
    }
    // Text is read whole into the window, so past the read bound it stays a row to download.
    if (!readsAsText(file.mime) || file.size > BYTES_READ_MAX_BYTES) {
        return 'none';
    }
    if (file.mime === 'text/html' || isHtmlName(file.name)) {
        return 'page';
    }
    if (file.mime === 'text/markdown' || isMarkdownName(file.name)) {
        return 'markdown';
    }
    return 'code';
}

/* The file a version opens on: the first one there is something to show of. */
export function firstShownFile(version: ArtifactVersion): number {
    const index = version.files.findIndex((file) => fileViewOf(file) !== 'none');
    return index === -1 ? 0 : index;
}

/* The bytes of one file of Output, for the renderers the files panel draws a binary file with. */
export function artifactSource(endpointId: string, reference: ArtifactFileRef): FileSource {
    return { kind: 'artifact', endpointId, ...reference };
}

/* A version never changes, so its time pins the bytes the way a file's mtime does. */
export function artifactBinaryRead(file: ArtifactFile, createdAt: number): FsReadBinary {
    return { kind: 'binary', mime: file.mime, size: file.size, mtime: createdAt };
}

/* The highlighter id for a file, guessed from its extension; one the highlighter does not know draws as plain text. */
export function languageOfName(name: string): string | undefined {
    return extensionOf(name.slice(name.lastIndexOf('/') + 1)) || undefined;
}
