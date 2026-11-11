import { DESIGN_ASSET_MAX_BYTES, DESIGN_FOLDERS, DESIGN_PAGE_MAX_BYTES, injectVisualBootstrap, type FsReadText } from '@ruimte/contracts';
import { designReadFailed, type DesignRead } from '@/design/design-page';
import { withDesignRuntime } from '@/design/design-runtime';
import { inlinedAsset, inlinedPage, pageFailureText } from '@/surface/inline-page';
import { machineTransport, pool } from '@/transport';
import { readPiece } from '@/transport-api/piece';
import { TransportError } from '@/transport-api/transport';
import { readResource } from '@/transport/byte-transfer';
import { machineAnswers } from '@/transport/features';
import { readLargeText } from '@/transport/large-text';
import { writeMachineText } from '@/transport/write-text';

/* A design's folder, and the project and design the machine knows it by; no project while the window has none. */
export interface DesignFolderRef {
    projectId: string | null;
    designId: string;
    folder: string;
}

/* What the design folder holds. A folder that is not there yet is its own answer, since the chat makes it with its first file; any other error is a failed read. */
export async function listDesignFolder(endpointId: string, folder: string): Promise<DesignRead> {
    try {
        // Hidden too: git ignores a private design's folder, and a listing leaves out what git ignores.
        const listed = await machineTransport(endpointId).request('fs.list', { path: folder, hidden: true });

        return { kind: 'listed', entries: listed.entries };
    } catch (error) {
        return designReadFailed(error);
    }
}

/* The names of the design folders of the project on disk, private and shared together; none while the project has no folder. */
export async function designFoldersOnDisk(endpointId: string, projectFolder: string | null): Promise<string[]> {
    if (projectFolder === null) {
        return [];
    }

    const transport = machineTransport(endpointId);
    const sides = await Promise.all(
        DESIGN_FOLDERS.map((folder) =>
            transport
                .request('fs.list', { path: `${projectFolder}/${folder}`, hidden: true })
                .then((listed) => listed.entries.filter((entry) => entry.kind === 'directory').map((entry) => entry.name))
                .catch(() => [])
        )
    );

    return sides.flat();
}

/*
 * One file of the design folder as text, past `fs.read`'s cap as well: that cap is what one frame carries,
 * and a page may be as large as a visual. Throws what a person can read when it is larger or not text.
 */
export async function readDesignText(endpointId: string, folder: string, file: string): Promise<FsReadText> {
    const path = `${folder}/${file}`;
    const first = await machineTransport(endpointId).request('fs.read', { path });
    const read = first.kind === 'too-large' ? await readLargeText(endpointId, path, first, null, DESIGN_PAGE_MAX_BYTES) : first;

    if (read.kind === 'too-large') {
        throw new Error(pageFailureText({ kind: 'too-large', name: file, size: read.size, limit: DESIGN_PAGE_MAX_BYTES }));
    }

    if (read.kind !== 'text') {
        throw new Error(pageFailureText({ kind: 'not-text', name: file }));
    }

    return read;
}

/*
 * Changes one page of the design as text, against the version it read: a write of the chat in between
 * is refused as stale by the machine, and nothing of the chat's work is overwritten. False when the
 * change had nothing to do.
 */
export async function rewriteDesignFile(endpointId: string, folder: string, file: string, change: (html: string) => string | null): Promise<boolean> {
    const transport = machineTransport(endpointId);
    const path = `${folder}/${file}`;
    const read = await readDesignText(endpointId, folder, file);
    const changed = change(read.text);

    if (changed === null || changed === read.text) {
        return false;
    }

    await writeMachineText(transport, path, changed, read.mtime);

    return true;
}

/* One page of the design as the sandbox frame takes it: standing on its own, with the bootstrap of a visual and the runtime of the stage. */
export async function readDesignPage(endpointId: string, design: DesignFolderRef, file: string): Promise<string> {
    return injectVisualBootstrap(withDesignRuntime(await standaloneDesignPage(endpointId, design, file)));
}

/* The bytes of one file of the design folder, by its path inside it, within the bounds of one file of a visual. */
export function readDesignAsset(endpointId: string, folder: string, path: string): Promise<Blob> {
    const transport = machineTransport(endpointId);

    return readResource((piece) => readPiece(transport, piece), { kind: 'file', path: `${folder}/${path}` }, { maxBytes: DESIGN_ASSET_MAX_BYTES });
}

/*
 * One page as a file that stands on its own (`inlineDesignPage`). Export hands this out. A machine that
 * answers `design.page` builds it next to the files, so the page travels once instead of every file it
 * names; an older one hands out the files and the page is built here.
 */
export async function standaloneDesignPage(endpointId: string, design: DesignFolderRef, file: string): Promise<string> {
    const { projectId, designId, folder } = design;

    if (projectId !== null && machineAnswers(pool.statusOf(endpointId), 'design.page')) {
        return builtOnMachine(endpointId, { projectId, designId, file });
    }

    return inlinedPage(
        {
            readPage: async (path) => {
                const read = await readDesignText(endpointId, folder, path);

                return { text: read.text, size: read.size };
            },
            readAsset: async (path) => inlinedAsset(path, await readDesignAsset(endpointId, folder, path))
        },
        file
    );
}

/*
 * A machine holds only a client's newest few built pages, so with many asked at once the oldest can be
 * let go before its first piece went out. That `not-found` is the held page gone, not the design: it is
 * built once more, and a second miss is the failure.
 */
async function builtOnMachine(endpointId: string, page: { projectId: string; designId: string; file: string }): Promise<string> {
    const transport = machineTransport(endpointId);

    for (let builds = 1; ; builds += 1) {
        const built = await transport.request('design.page', page);

        if (built.kind !== 'page') {
            throw new Error(pageFailureText(built));
        }

        try {
            const blob = await readResource((piece) => readPiece(transport, piece), { kind: 'designPage', pageId: built.pageId });

            return await blob.text();
        } catch (error) {
            if (builds >= 2 || !(error instanceof TransportError) || error.code !== 'not-found') {
                throw error;
            }
        }
    }
}
