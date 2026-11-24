import { Glob } from 'bun';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { DEVELOPMENT_EXTENSION_FOLDERS } from '../apps/server/src/extensions/provenance.ts';

/*
 * No build carries a development extension: this searches what a build wrote for the id of each and for the path of
 * its folder, and fails on a hit. The dev launch alone loads them (`apps/server/scripts/dev-extensions.ts`), so either
 * in a bundle or a binary means something imports one.
 *
 *   bun scripts/check-build-outputs.ts               the outputs of this checkout that exist
 *   bun scripts/check-build-outputs.ts <path>...     these files and folders instead
 */

// What `bun run build`, `dist` and the web client bundles write, and what the desktop pack takes in.
const OUTPUTS = ['apps/client/dist', 'apps/desktop/dist', 'apps/station/dist', 'apps/bench/dist', 'apps/server/dist'];
const NAME_BYTE = /[A-Za-z0-9_$-]/;

export interface Needle {
    text: string;
    /* An id only counts as a word of its own: `poc.chat` is not in `epoc.chatter`. */
    whole: boolean;
}

/* The id and the folder of every development extension of a checkout. */
export function needlesOf(repository: string): Needle[] {
    return DEVELOPMENT_EXTENSION_FOLDERS.flatMap((parent) => {
        const folder = join(repository, parent);

        if (!existsSync(folder)) {
            return [];
        }

        return readdirSync(folder).flatMap((name) => {
            const manifest = join(folder, name, 'manifest.json');

            if (!existsSync(manifest)) {
                return [];
            }

            const { id } = JSON.parse(readFileSync(manifest, 'utf8')) as { id: string };

            return [
                { text: id, whole: true },
                { text: `${parent}/${name}/`, whole: false }
            ];
        });
    });
}

/* The needles a file's bytes hold. */
export function leaksIn(bytes: Buffer, needles: readonly Needle[]): string[] {
    return needles
        .filter(({ text, whole }) => {
            for (let at = bytes.indexOf(text); at !== -1; at = bytes.indexOf(text, at + 1)) {
                const before = at === 0 ? '' : String.fromCharCode(bytes[at - 1] as number);
                const after = String.fromCharCode(bytes[at + text.length] ?? 0);

                if (!whole || (!NAME_BYTE.test(before) && before !== '.' && !NAME_BYTE.test(after))) {
                    return true;
                }
            }

            return false;
        })
        .map((needle) => needle.text);
}

function filesUnder(path: string): string[] {
    return statSync(path).isDirectory() ? [...new Glob('**/*').scanSync({ cwd: path, onlyFiles: true, dot: true })].map((file) => join(path, file)) : [path];
}

if (import.meta.main) {
    const repository = resolve(import.meta.dir, '..');
    const given = process.argv.slice(2);
    const outputs = (given.length > 0 ? given.map((path) => resolve(path)) : OUTPUTS.map((path) => join(repository, path))).filter((path) => existsSync(path));
    const needles = needlesOf(repository);

    if (outputs.length === 0) {
        console.error('No build output to check. Build first, or name a file or folder.');
        process.exit(1);
    }

    if (needles.length === 0) {
        console.error(`No development extension found under ${DEVELOPMENT_EXTENSION_FOLDERS.join(' or ')}, so there is nothing to look for.`);
        process.exit(1);
    }

    const files = outputs.flatMap(filesUnder);
    const leaks = files.flatMap((file) => leaksIn(readFileSync(file), needles).map((needle) => `  ${relative(repository, file)}: ${needle}`));

    if (leaks.length > 0) {
        console.error(`A build holds a development extension, which only the dev launch may load:\n${leaks.join('\n')}`);
        process.exit(1);
    }

    console.log(`Checked ${files.length} files of ${outputs.length} build outputs for ${needles.length / 2} development extensions.`);
}
