import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';

// What the shell strips from a version before it reads its files.
const LOAD_MARK = /~\d+(?=\/)/;
const LOAD_PREFIX = /^\/?load:/;

/*
 * Answers a load's address as the shell does, with the files of its version, while the page keeps a module for each
 * address it was asked under. A relative import of such a module stays under its load.
 */
export function serveExtensionLoads(): void {
    Bun.plugin({
        name: 'extension-loads',
        setup(build) {
            build.onResolve({ filter: LOAD_MARK }, (args) => ({ path: args.path, namespace: 'load' }));
            build.onResolve({ filter: /^\.\.?\// }, (args) => {
                const importer = args.importer.replace(LOAD_PREFIX, '');

                return LOAD_MARK.test(importer) ? { path: join(dirname(importer), args.path), namespace: 'load' } : undefined;
            });
            build.onLoad({ filter: /.*/, namespace: 'load' }, (args) => ({
                contents: readFileSync(args.path.replace(LOAD_PREFIX, '').replace(LOAD_MARK, ''), 'utf8'),
                loader: 'js'
            }));
        }
    });
}

/* What a pack writes under `folder`: the API comes from the page, and the module registers when it runs, or later through `later`. */
export function writeExtension(folder: string, id: string, module: string): InstalledClientExtension {
    const base = join(folder, id);

    mkdirSync(join(base, 'client'), { recursive: true });
    writeFileSync(join(base, 'client', 'index.js'), module);

    return {
        manifest: { id, name: id, version: '0.1.0', api: 1, permissions: {} },
        base: `${base}/`,
        enabled: true,
        hasClient: true,
        dev: false
    };
}
