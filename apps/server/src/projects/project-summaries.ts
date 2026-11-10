import { basename } from 'node:path';
import { fileExists } from '@adecore/utils/fs';
import { initialIconOf, type ProjectIcon, type ProjectNameSource, type ProjectSetIconPayload, type ProjectSummary } from '@ruimte/contracts';
import { ProjectError } from './project-error.ts';
import { documentPathInFolder, removeIconFiles, writeIconFile, ICON_EXTENSION_BY_MIME } from './project-files.ts';
import { IdentityCache, servedIcon, sniffIconMime, ICON_MAX_BYTES, type DerivedIcon } from './project-identity.ts';
import type { RegistryEntry } from './project-registry.ts';

// The only file in `.ruimte` besides the canvas that the daemon has a use for.
export function isIconFile(filename: string): boolean {
    return filename.startsWith('icon.');
}

export function sameIcon(left: ProjectIcon | null, right: ProjectIcon | null): boolean {
    return left === right || (left !== null && right !== null && left.kind === right.kind && left.value === right.value);
}

/* What a project looks like in a client's list: the name and color from its file, and the icon chosen there or found in its folder. */
export class ProjectSummaries {
    private readonly scratchFolder: string;
    private readonly identity = new IdentityCache();

    constructor(scratchFolder: string) {
        this.scratchFolder = scratchFolder;
    }

    async summarize(entry: RegistryEntry): Promise<ProjectSummary> {
        const available = await fileExists(documentPathInFolder(entry.folder));
        const image = (await this.identity.resolve(entry.folder)).icon;
        const icon: ProjectIcon = entry.icon ?? (image ? imageIcon(image) : initialIconOf(entry.name));
        return {
            projectId: entry.projectId,
            name: entry.name,
            color: entry.color,
            folder: entry.folder,
            lastOpenedAt: entry.lastOpenedAt,
            closedAt: entry.closedAt ?? null,
            available,
            icon,
            nameSource: nameSourceOf(entry.name, entry.folder),
            ...(entry.folder === this.scratchFolder ? { scratch: true } : {})
        };
    }

    /* The folder is looked at again on the next summary, whatever the cache holds. */
    invalidate(folder: string): void {
        this.identity.invalidate(folder);
    }

    /*
     * Writes or removes `<folder>/.ruimte/icon.<ext>`. The bytes are checked against their own
     * magic, never the MIME the client claims, so a file that is not an image never lands there.
     */
    async setImage(folder: string, image: ProjectSetIconPayload['image']): Promise<void> {
        if (image === null) {
            await removeIconFiles(folder);
        } else {
            const bytes = decodeImage(image.base64);
            const mime = sniffIconMime(bytes);
            const extension = mime ? ICON_EXTENSION_BY_MIME[mime] : undefined;
            if (!extension) {
                throw new ProjectError('bad-icon', 'That file is not a PNG, JPEG, GIF, WebP, HEIC, HEIF or SVG image');
            }
            await writeIconFile(folder, extension, bytes);
        }
        this.invalidate(folder);
    }

    async iconFile(entry: RegistryEntry | undefined, theme: 'light' | 'dark'): Promise<{ path: string; mime: string } | null> {
        if (!entry || entry.icon) {
            return null;
        }
        const icon = (await this.identity.resolve(entry.folder)).icon;
        return icon ? await servedIcon(entry.folder, icon, theme) : null;
    }
}

function imageIcon(icon: DerivedIcon): ProjectIcon {
    return { kind: 'image', value: icon.from, version: icon.version };
}

/* A name that still matches the folder's is the folder's, even one typed by hand: nothing on disk says otherwise. */
function nameSourceOf(name: string, folder: string): ProjectNameSource {
    return name === basename(folder) ? 'folder' : 'chosen';
}

function decodeImage(base64: string): Uint8Array {
    // Base64 carries three bytes per four characters; the cap is checked before decoding a blob.
    if (Math.ceil(base64.length / 4) * 3 > ICON_MAX_BYTES) {
        throw new ProjectError('bad-icon', 'That image is larger than 256 KB');
    }
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0 || bytes.length > ICON_MAX_BYTES) {
        throw new ProjectError('bad-icon', 'That image is empty or larger than 256 KB');
    }
    return bytes;
}
