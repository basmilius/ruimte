import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

/* The files of a skill folder by their path inside it, with slashes. */
export type SkillFiles = Readonly<Record<string, string>>;

/* What placing the skills reads and writes under `$RUIMTE_HOME/skills`; a test hands in one held in memory. */
export interface SkillDisk {
    /* Every file of a folder, or null when there is no folder. */
    readFolder(path: string): Promise<SkillFiles | null>;
    readText(path: string): Promise<string | null>;
    /* Puts these files where the folder is, written beside it first, so a reader finds the old folder or the new one whole. */
    replaceFolder(path: string, files: SkillFiles): Promise<void>;
    writeText(path: string, text: string): Promise<void>;
    remove(path: string): Promise<void>;
}

function isMissing(error: unknown): boolean {
    return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

async function filesBelow(root: string, folder: string, into: Record<string, string>): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);

        if (entry.isDirectory()) {
            await filesBelow(root, path, into);
        } else if (entry.isFile()) {
            into[relative(root, path).split(sep).join('/')] = await readFile(path, 'utf8');
        }
    }
}

/* A sibling name no other write uses, so two daemons on one home never write into each other's copy. */
function besideName(path: string, purpose: string): string {
    return join(dirname(path), `.${purpose}-${randomBytes(6).toString('hex')}`);
}

export const nodeSkillDisk: SkillDisk = {
    readFolder: async (path) => {
        const files: Record<string, string> = {};

        try {
            await filesBelow(path, path, files);
        } catch (e) {
            if (isMissing(e)) {
                return null;
            }

            throw e;
        }

        return files;
    },
    readText: async (path) => {
        try {
            return await readFile(path, 'utf8');
        } catch (e) {
            if (isMissing(e)) {
                return null;
            }

            throw e;
        }
    },
    replaceFolder: async (path, files) => {
        const fresh = besideName(path, 'new');
        const old = besideName(path, 'old');

        try {
            for (const [name, text] of Object.entries(files)) {
                const file = join(fresh, ...name.split('/'));
                await mkdir(dirname(file), { recursive: true });
                await writeFile(file, text);
            }

            // A folder never renames onto one that holds files, so the old one steps aside for the moment the new one moves in.
            const stepped = await rename(path, old).then(
                () => true,
                (e: unknown) => {
                    if (isMissing(e)) {
                        return false;
                    }

                    throw e;
                }
            );
            try {
                await rename(fresh, path);
            } catch (e) {
                if (stepped) {
                    await rename(old, path);
                }

                throw e;
            }

            if (stepped) {
                await rm(old, { recursive: true, force: true });
            }
        } finally {
            await rm(fresh, { recursive: true, force: true });
        }
    },
    writeText: async (path, text) => {
        await mkdir(dirname(path), { recursive: true });
        const fresh = besideName(path, 'write');
        await writeFile(fresh, text);
        await rename(fresh, path);
    },
    remove: (path) => rm(path, { recursive: true, force: true })
};
