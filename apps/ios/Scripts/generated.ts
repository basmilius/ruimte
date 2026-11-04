import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

/** The iOS app's folder, which every generated path is relative to. */
export const root = resolve(import.meta.dir, '..');

/** The folder of the installed package `name` as `from` resolves it, which holds its manifest and license. */
export function packageDirectory(name: string, from: string): string {
    let folder = dirname(createRequire(from).resolve(name));
    while (true) {
        const manifest = resolve(folder, 'package.json');
        if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) {
            return folder;
        }
        const parent = dirname(folder);
        if (parent === folder) {
            throw new Error(`Could not find the package ${name}`);
        }
        folder = parent;
    }
}

/** Writes each file, or with `--check` fails on the first one that differs from what is on disk. */
export async function writeGenerated(outputs: Map<string, string>, what: string): Promise<void> {
    const checking = process.argv.includes('--check');
    for (const [path, contents] of outputs) {
        const destination = resolve(root, path);
        if (checking) {
            if ((await readFile(destination, 'utf8').catch(() => '')) !== contents) {
                throw new Error(`Stale generated file: ${destination}`);
            }
        } else {
            await mkdir(resolve(destination, '..'), { recursive: true });
            await writeFile(destination, contents);
        }
    }
    console.log(`${checking ? 'Checked' : 'Generated'} ${what}.`);
}
