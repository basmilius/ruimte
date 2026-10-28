import { injectVisualBootstrap } from '@ruimte/contracts';
import { machineTransport } from '@/transport';
import { readResource } from '@/transport/byte-transfer';
import { readPiece } from '@/transport/piece';
import { withDesignRuntime } from '@/design/design-runtime';
import { DESIGN_FOLDERS } from '@/design/design-folder';
import { assetPathOf, assetReferences, designFiles, DESIGN_ASSET_MAX_BYTES, DESIGN_PAGE_MAX_BYTES, withAssets } from '@/design/design-page';

/* The pages of the design folder, or null while the folder is not there yet: the chat makes it with its first file. */
export async function listDesignFiles(endpointId: string, folder: string): Promise<string[] | null> {
    try {
        // Hidden too: git ignores a private design's folder, and a listing leaves out what git ignores.
        const listed = await machineTransport(endpointId).request('fs.list', { path: folder, hidden: true });

        return designFiles(listed.entries);
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
 * Changes one page of the design as text, against the version it read: a write of the chat in between
 * is refused as stale by the machine, and nothing of the chat's work is overwritten. False when the
 * change had nothing to do.
 */
export async function rewriteDesignFile(endpointId: string, folder: string, file: string, change: (html: string) => string | null): Promise<boolean> {
    const transport = machineTransport(endpointId);
    const path = `${folder}/${file}`;
    const read = await transport.request('fs.read', { path });

    if (read.kind !== 'text') {
        throw new Error(`${file} is not a text file`);
    }

    const changed = change(read.text);

    if (changed === null || changed === read.text) {
        return false;
    }

    await transport.request('fs.write', { path, text: changed, expectedMtime: read.mtime });

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

/*
 * One page as a file that stands on its own: the frame writes a page from a string, so every file of the
 * folder it pulls in rides along as its bytes, up to the bounds of a visual. A file that cannot be read
 * stays a reference that loads nothing, the way a broken path does in a browser. Export hands this out.
 */
export async function standaloneDesignPage(endpointId: string, folder: string, file: string): Promise<string> {
    const transport = machineTransport(endpointId);
    const read = await transport.request('fs.read', { path: `${folder}/${file}` });

    if (read.kind !== 'text') {
        throw new Error(`${file} is not a text file`);
    }

    const inline = new Map<string, string>();
    let total = read.size;

    for (const reference of assetReferences(read.text)) {
        const path = assetPathOf(reference);

        if (path === null) {
            continue;
        }

        try {
            const blob = await readResource(
                (piece) => readPiece(transport, piece),
                { kind: 'file', path: `${folder}/${path}` },
                { maxBytes: DESIGN_ASSET_MAX_BYTES }
            );

            if (total + blob.size > DESIGN_PAGE_MAX_BYTES) {
                break;
            }

            total += blob.size;
            inline.set(reference, await dataUrlOf(blob));
        } catch {
            // Left as it is: the frame shows the page without it.
        }
    }

    return withAssets(read.text, inline);
}
