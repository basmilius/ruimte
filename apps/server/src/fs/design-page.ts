import { realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { CodedError } from '@adecore/agents';
import { isBelow, isWithin } from '@adecore/utils/path';
import {
    assetPathOf,
    DESIGN_ASSET_MAX_BYTES,
    DESIGN_PAGE_MAX_BYTES,
    designAssetType,
    designFolderOf,
    designPlaces,
    DesignPageError,
    inlineDesignPage,
    isPagePath,
    isSharedDesign,
    type DesignFiles,
    type ProjectView
} from '@ruimte/contracts';
import { inspect, readServedFile } from './read.ts';

type DesignPathErrorCode = 'not-a-design' | 'outside-design';

export class DesignPathError extends CodedError<DesignPathErrorCode> {}

/* What a project says of its designs: its folder, its views and which of them are shared. */
export interface DesignProject {
    folder: string;
    views: readonly ProjectView[];
    shared: readonly string[];
}

/* One page of one design folder: the folder absolute, the page by its path inside it. */
export interface DesignPageAt {
    folder: string;
    file: string;
}

/* The folder of every design of the project, absolute. */
export function designFoldersOf(project: DesignProject): Array<{ id: string; folder: string }> {
    return designPlaces(project.views).map((design) => ({
        id: design.id,
        folder: resolve(project.folder, designFolderOf(design, isSharedDesign(design, project.shared)))
    }));
}

/* The page path inside a design folder as the inliner names it: relative, with slashes, and no step that leaves the folder. */
function pagePathOf(file: string): string | null {
    const path = assetPathOf(file);

    return path !== null && path === file && isPagePath(path) ? path : null;
}

/* A page of a design of the project by the design's id; refused for an id that is no design or a path that is no page inside it. */
export function designPageById(project: DesignProject, designId: string, file: string): DesignPageAt {
    const design = designFoldersOf(project).find((candidate) => candidate.id === designId);

    if (design === undefined) {
        throw new DesignPathError('not-a-design', `${designId} is no design of this project`);
    }

    const path = pagePathOf(file);

    if (path === null) {
        throw new DesignPathError('outside-design', `${file} is no page inside the folder of the design`);
    }

    return { folder: design.folder, file: path };
}

/*
 * The design folder a page lies in, by its path absolute or relative to the project folder, and its path
 * inside that folder; null for a path that is no HTML page inside a design folder of the project. A
 * design whose folder lies in another's is the one the page is nearest to.
 */
export function designPageByPath(project: DesignProject, path: string): DesignPageAt | null {
    const absolute = isAbsolute(path) ? resolve(path) : resolve(project.folder, path);
    const holding = designFoldersOf(project)
        .filter((design) => isBelow(design.folder, absolute))
        .sort((one, other) => other.folder.length - one.folder.length)[0];

    if (holding === undefined) {
        return null;
    }

    const file = pagePathOf(relative(holding.folder, absolute).split(sep).join('/'));

    return file === null ? null : { folder: holding.folder, file };
}

function decodeStrict(bytes: Uint8Array): string | null {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return null;
    }
}

/*
 * The files of a design folder as the inliner reads them, each judged by where it really is: a path that
 * leaves the folder, also through a symlink, is read as a file that is not there, and so is the folder
 * itself when it really lies outside the project. Every bound is the one the client keeps when it reads
 * the same files over `fs.read` and `bytes.read`, so the page comes out the same.
 */
async function folderFiles(projectFolder: string, folder: string): Promise<DesignFiles> {
    const [project, root] = await Promise.all([realpath(projectFolder).catch(() => null), realpath(folder).catch(() => null)]);
    const usable = project !== null && root !== null && isBelow(project, root);

    const inside = async (path: string): Promise<string | null> => {
        if (!usable || assetPathOf(path) !== path) {
            return null;
        }

        const real = await realpath(join(root, ...path.split('/'))).catch(() => null);

        return real !== null && isWithin(root, real) && real !== root ? real : null;
    };

    return {
        readPage: async (path) => {
            const real = await inside(path);

            if (real === null) {
                throw new DesignPageError({ kind: 'missing', name: path });
            }

            const { file, mime } = await inspect(real);

            if (mime !== null) {
                throw new DesignPageError({ kind: 'not-text', name: path });
            }

            if (file.size > DESIGN_PAGE_MAX_BYTES) {
                throw new DesignPageError({ kind: 'too-large', name: path, size: file.size, limit: DESIGN_PAGE_MAX_BYTES });
            }

            const text = decodeStrict(await Bun.file(file.path).bytes());

            if (text === null) {
                throw new DesignPageError({ kind: 'not-text', name: path });
            }

            return { text, size: file.size };
        },
        readAsset: async (path) => {
            const real = await inside(path);
            const served = real === null ? null : await readServedFile(real);

            if (served === null || served.size > DESIGN_ASSET_MAX_BYTES) {
                throw new DesignPathError('outside-design', `${path} is not a file the page may carry`);
            }

            const bytes = Buffer.from(await served.bytes.arrayBuffer());

            return { url: `data:${designAssetType(path, served.mime)};base64,${bytes.toString('base64')}`, size: served.size };
        }
    };
}

/* One page of a design folder standing on its own (`inlineDesignPage`); throws a `DesignPageError` when the page itself cannot be built. */
export async function assembleDesignPage(projectFolder: string, page: DesignPageAt): Promise<string> {
    return inlineDesignPage(await folderFiles(projectFolder, page.folder), page.file);
}
