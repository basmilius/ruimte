/*
 * Loads an extension's entry afresh for each test host and test server: bundled with every file of the project it
 * imports, so no module state carries from one to the next, and with `@ruimte/extension/<part>` bound to the one it
 * was loaded for. A package from `node_modules` stays outside the bundle and loads once, as anywhere else.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const apis = new Map<string, object>();
let loads = 0;
let cache: string | null = null;

(globalThis as Record<string, unknown>).__ruimteExtensionTest = { for: (key: string) => apis.get(key) };

/* Inside the project, so a package the bundle leaves out resolves from the project's own `node_modules`. */
function cacheFolder(): string {
    if (cache === null) {
        const parent = join(process.cwd(), 'node_modules', '.cache');

        mkdirSync(parent, { recursive: true });

        const folder = mkdtempSync(join(parent, 'ruimte-extension-load-'));

        process.on('exit', () => rmSync(folder, { recursive: true, force: true }));
        cache = folder;
    }

    return cache;
}

/* The module `entry` exports, with each of `bound` (such as `@ruimte/extension/server`) answering the object given for it. */
export async function loadFresh(entry: string, bound: Readonly<Record<string, object>>): Promise<Record<string, unknown>> {
    loads += 1;

    const load = loads;

    for (const [name, api] of Object.entries(bound)) {
        apis.set(`${load}:${name}`, api);
    }

    const build = await Bun.build({
        entrypoints: [entry],
        outdir: join(cacheFolder(), String(load)),
        target: 'bun',
        format: 'esm',
        // A lazy component stays lazy, as in Ruimte, so a test that draws nothing needs no React.
        splitting: true,
        packages: 'external',
        sourcemap: 'inline',
        jsx: { runtime: 'automatic', development: false },
        plugins: [
            {
                name: 'ruimte-extension-test',
                setup(builder) {
                    builder.onResolve({ filter: /^@ruimte\/extension\// }, (args) =>
                        Object.hasOwn(bound, args.path) ? { path: args.path, namespace: 'ruimte-test' } : undefined
                    );
                    builder.onLoad({ filter: /.*/, namespace: 'ruimte-test' }, (args) => ({
                        // CommonJS, as in a pack, so a named import reads a property when it runs and needs no list of names.
                        contents: `module.exports = globalThis.__ruimteExtensionTest.for(${JSON.stringify(`${load}:${args.path}`)});`,
                        loader: 'js'
                    }));
                }
            }
        ],
        throw: false
    });
    const output = build.outputs.find((each) => each.kind === 'entry-point');

    if (!build.success || output === undefined) {
        throw new Error(`${relative(process.cwd(), entry)} did not build:\n${build.logs.map(String).join('\n')}`);
    }

    return (await import(pathToFileURL(output.path).href)) as Record<string, unknown>;
}
