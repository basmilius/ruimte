import i18next from 'i18next';
import { injectVisualBootstrap, type FsEntry, type FsReadText } from '@ruimte/contracts';
import { formatBytes } from '@adecore/ui/format';
import { readLargeText } from '@/shell/panels/large-text';
import { machineTransport } from '@/transport';
import { readResource } from '@/transport/byte-transfer';
import { readPiece } from '@/transport/piece';
import { writeMachineText } from '@/transport/write-text';
import { withDesignRuntime } from '@/design/design-runtime';
import { DESIGN_FOLDERS } from '@/design/design-folder';
import { DESIGN_ASSET_MAX_BYTES, DESIGN_PAGE_MAX_BYTES } from '@/design/design-page';
import { inlineDesignPage } from '@/design/design-inline';

/* What the design folder holds, or null while the folder is not there yet: the chat makes it with its first file. */
export async function listDesignFolder(endpointId: string, folder: string): Promise<FsEntry[] | null> {
    try {
        // Hidden too: git ignores a private design's folder, and a listing leaves out what git ignores.
        const listed = await machineTransport(endpointId).request('fs.list', { path: folder, hidden: true });

        return listed.entries;
    } catch {
        return null;
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
        throw new Error(i18next.t('shell:design.pageTooLarge', { name: file, size: formatBytes(read.size), limit: formatBytes(DESIGN_PAGE_MAX_BYTES) }));
    }

    if (read.kind !== 'text') {
        throw new Error(i18next.t('shell:design.pageNotText', { name: file }));
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

function dataUrlOf(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
        reader.readAsDataURL(blob);
    });
}

/* One page of the design as the sandbox frame takes it: standing on its own, with the bootstrap of a visual and the runtime of the stage. */
export async function readDesignPage(endpointId: string, folder: string, file: string): Promise<string> {
    return injectVisualBootstrap(withDesignRuntime(await standaloneDesignPage(endpointId, folder, file)));
}

/* The bytes of one file of the design folder, by its path inside it, within the bounds of one file of a visual. */
export function readDesignAsset(endpointId: string, folder: string, path: string): Promise<Blob> {
    const transport = machineTransport(endpointId);

    return readResource((piece) => readPiece(transport, piece), { kind: 'file', path: `${folder}/${path}` }, { maxBytes: DESIGN_ASSET_MAX_BYTES });
}

/* One page as a file that stands on its own (`inlineDesignPage`). Export hands this out. */
export async function standaloneDesignPage(endpointId: string, folder: string, file: string): Promise<string> {
    return inlineDesignPage(
        {
            readPage: async (path) => {
                const read = await readDesignText(endpointId, folder, path);

                return { text: read.text, size: read.size };
            },
            readAsset: async (path) => {
                const blob = await readDesignAsset(endpointId, folder, path);

                return { url: await dataUrlOf(blob), size: blob.size };
            }
        },
        file
    );
}
