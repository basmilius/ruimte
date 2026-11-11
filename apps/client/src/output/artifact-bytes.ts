import { formatBytes } from '@adecore/ui/format';
import { BYTES_READ_MAX_BYTES, DESIGN_ASSET_MAX_BYTES, DESIGN_PAGE_MAX_BYTES, DesignPageError, type ArtifactFile } from '@ruimte/contracts';
import i18next from 'i18next';
import { useEffect, useState } from 'react';
import { desktop, type SaveFileStreamBridge } from '@/desktop/bridge';
import { saveBlob } from '@/download';
import { useToasts } from '@/state/toasts';
import { inlinedAsset, inlinedPage } from '@/surface/inline-page';
import { machineTransport } from '@/transport';
import { readPiece } from '@/transport-api/piece';
import { fireAndForget } from '@/transport-api/transport';
import { readResource, streamResource } from '@/transport/byte-transfer';

export interface ArtifactFileRef {
    artifactId: string;
    versionId: string;
    file: number;
}

/* A file of a version, whole: its size is known and bounded, so the read is allowed up to exactly that. */
export function readArtifactFile(endpointId: string, ref: ArtifactFileRef, file: ArtifactFile): Promise<Blob> {
    const transport = machineTransport(endpointId);
    return readResource((piece) => readPiece(transport, piece), { kind: 'artifact', ...ref }, { maxBytes: Math.max(file.size, 1) });
}

/*
 * An HTML file of a version as a page that stands on its own. Beside other files of its version, what it names
 * of them is inlined as a design page is, and only from that version: a saved design draws as it was saved,
 * whatever its folder holds now. A file the version does not hold, or one past a bound, loads nothing.
 */
export async function readArtifactPage(endpointId: string, ref: ArtifactFileRef, files: readonly ArtifactFile[]): Promise<string> {
    const file = files[ref.file]!;

    if (files.length === 1) {
        return (await readArtifactFile(endpointId, ref, file)).text();
    }

    const indexOf = new Map(files.map((entry, index) => [entry.name, index]));

    const read = async (path: string, maxBytes: number): Promise<Blob> => {
        const index = indexOf.get(path);

        if (index === undefined) {
            throw new DesignPageError({ kind: 'missing', name: path });
        }

        const named = files[index]!;

        if (named.size > maxBytes) {
            throw new DesignPageError({ kind: 'too-large', name: path, size: named.size, limit: maxBytes });
        }

        return readArtifactFile(endpointId, { ...ref, file: index }, named);
    };

    return inlinedPage(
        {
            readPage: async (path) => {
                const blob = await read(path, DESIGN_PAGE_MAX_BYTES);

                return { text: await blob.text(), size: blob.size };
            },
            readAsset: async (path) => inlinedAsset(path, await read(path, DESIGN_ASSET_MAX_BYTES))
        },
        file.name
    );
}

/* Whole up to the read bound, and past it only where the shell writes a file as its pieces arrive. */
export function canDownload(file: ArtifactFile): boolean {
    return file.size <= BYTES_READ_MAX_BYTES || desktop()?.saveFileStream !== undefined;
}

export async function downloadArtifactFile(endpointId: string, ref: ArtifactFileRef, file: ArtifactFile): Promise<void> {
    const name = file.name.slice(file.name.lastIndexOf('/') + 1);
    const stream = desktop()?.saveFileStream;
    if (file.size > BYTES_READ_MAX_BYTES && stream !== undefined) {
        await saveInPieces(stream, endpointId, ref, file, name);
        return;
    }
    const blob = await readArtifactFile(endpointId, ref, file);
    await saveBlob(blob, name, file.mime);
}

class Cancelled extends Error {}

async function saveInPieces(stream: SaveFileStreamBridge, endpointId: string, ref: ArtifactFileRef, file: ArtifactFile, name: string): Promise<void> {
    const id = await stream.begin(name, file.mime);
    if (id === null) {
        return;
    }
    const toasts = useToasts.getState();
    const total = formatBytes(file.size);
    let cancelled = false;
    let written = 0;
    const toastId = toasts.show({
        kind: 'progress',
        title: i18next.t('output:view.downloading', { name }),
        description: i18next.t('output:view.downloadProgress', { done: formatBytes(0), total }),
        action: {
            label: i18next.t('common:action.cancel'),
            run: () => {
                cancelled = true;
            }
        }
    });
    const transport = machineTransport(endpointId);
    try {
        await streamResource(
            (piece) => readPiece(transport, piece),
            { kind: 'artifact', ...ref },
            async (bytes) => {
                if (cancelled) {
                    throw new Cancelled();
                }
                await stream.write(id, bytes);
                written += bytes.length;
                toasts.update(toastId, { description: i18next.t('output:view.downloadProgress', { done: formatBytes(written), total }) });
            }
        );
        if (cancelled) {
            throw new Cancelled();
        }
        const path = await stream.end(id);
        toasts.update(toastId, { kind: 'success', title: i18next.t('output:view.downloaded', { name }), description: path, action: undefined });
    } catch (error: unknown) {
        await fireAndForget('stream.abort', stream.abort(id));
        toasts.dismiss(toastId);
        if (!(error instanceof Cancelled)) {
            throw error;
        }
    }
}

type TextState = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'failed' };

/* The text of a file of a version. A version never changes, so what was read once stays right. */
export function useArtifactText(endpointId: string, ref: ArtifactFileRef | null, file: ArtifactFile | null): TextState {
    const key = ref === null ? null : `${endpointId}\n${ref.artifactId}\n${ref.versionId}\n${ref.file}`;
    const [held, setHeld] = useState<{ key: string; state: TextState } | null>(null);
    const artifactId = ref?.artifactId;
    const versionId = ref?.versionId;
    const index = ref?.file;
    useEffect(() => {
        if (key === null || file === null || artifactId === undefined || versionId === undefined || index === undefined) {
            return;
        }
        let live = true;
        readArtifactFile(endpointId, { artifactId, versionId, file: index }, file)
            .then((blob) => blob.text())
            .then(
                (text) => live && setHeld({ key, state: { status: 'ready', text } }),
                () => live && setHeld({ key, state: { status: 'failed' } })
            );
        return () => {
            live = false;
        };
    }, [endpointId, key, artifactId, versionId, index, file]);
    return held !== null && held.key === key ? held.state : LOADING;
}

const LOADING: TextState = { status: 'loading' };
