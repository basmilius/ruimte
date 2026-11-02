import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { ExtensionThemeSchema, isSafePackPath, type ExtensionManifest } from '@ruimte/contracts';

// Loaded whole by a client; `server/` only ever runs on the machine.
const CLIENT_FOLDERS = ['client', 'assets', 'locales', 'themes', 'views'];

/*
 * What a client with no shell of its own loads of an installed extension, by path, in base64: `manifest.json`, the
 * client folders and every file a theme names wherever it sits in the pack. As the shell serves a file, only one
 * whose real path is inside the folder, so a link in a dev folder hands out nothing else of this machine.
 */
export async function clientFilesOf(folder: string, manifest: ExtensionManifest): Promise<Record<string, string>> {
    const inside = `${await realpath(folder)}${sep}`;
    const files: Record<string, string> = {};

    const add = async (path: string, visiting: ReadonlySet<string> = new Set()): Promise<void> => {
        if (Object.hasOwn(files, path) || !isSafePackPath(path)) {
            return;
        }

        const real = await realpath(join(folder, path)).catch(() => null);

        if (real === null || !real.startsWith(inside) || visiting.has(real)) {
            return;
        }

        if (!(await stat(real)).isDirectory()) {
            files[path] = (await readFile(real)).toString('base64');

            return;
        }

        for (const name of await readdir(real)) {
            await add(`${path}/${name}`, new Set([...visiting, real]));
        }
    };

    await add('manifest.json');

    for (const name of CLIENT_FOLDERS) {
        await add(name);
    }

    for (const path of manifest.themes ?? []) {
        await add(path);

        const theme = Object.hasOwn(files, path) ? ExtensionThemeSchema.safeParse(parsed(files[path] as string)) : null;

        if (theme?.success === true) {
            await add(theme.data.thumbnail);

            if (theme.data.css !== undefined) {
                await add(theme.data.css);
            }
        }
    }

    return files;
}

function parsed(base64: string): unknown {
    try {
        return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    } catch {
        return null;
    }
}
