import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

/* A grammar or a theme by its id, as shiki's bundles import each one. */
const SHIPPED_ONCE = /^@shikijs\/(langs|themes)\/([\w.+-]+)$/;

export interface ShikiModules {
    /* The folders of the packages' own modules, which import each other by file name. */
    folders: Record<'langs' | 'themes', string>;
    version: string;
    /* Keep the installed instantiator and its named exports, not a custom loader. */
    wasm: string;
}

/* The resources of the shiki the client imports, found the way the bundle finds them. */
export function shikiModules(): ShikiModules {
    const shiki = createRequire(createRequire(import.meta.url).resolve('shiki'));
    const langs = dirname(shiki.resolve('@shikijs/langs/javascript'));
    const themes = dirname(shiki.resolve('@shikijs/themes/github-dark'));
    const version = (JSON.parse(readFileSync(join(langs, '..', 'package.json'), 'utf8')) as { version: string }).version;
    const wasm = shiki.resolve('@shikijs/engine-oniguruma/wasm-inlined');

    return { folders: { langs, themes }, version, wasm };
}

/* The modules of a folder a browser imports: every grammar or theme by itself, without the index that imports them all. */
export function shippedFiles(names: readonly string[]): string[] {
    return names.filter((name) => name.endsWith('.mjs') && name !== 'index.mjs');
}

/* Where a build points an import of shiki's: `null` for one it bundles as usual. */
export function shippedPath(source: string, version: string): string | null {
    if (source === '@shikijs/engine-oniguruma/wasm-inlined') {
        return `assets/shiki-${version}/wasm.mjs`;
    }

    const match = SHIPPED_ONCE.exec(source);
    return match === null ? null : `assets/shiki-${version}/${match[1]}/${match[2]}.mjs`;
}

/*
 * Every grammar, theme and the inlined wasm module once, beside the chunks. The page and the diff syntax worker are two
 * bundles that cannot share a chunk, so each would carry all of them; instead both import the
 * packages' own modules from one folder, named after the version as pdf.js's files are. `emit` is
 * the page's build; the worker only points at it. Only a build: the dev server serves them as they are.
 */
export function shikiOnce({ folders, version, wasm }: ShikiModules, emit: boolean): Plugin {
    let base = '/';
    return {
        name: 'ruimte-shiki-once',
        apply: 'build',
        enforce: 'pre',
        configResolved: (config) => {
            base = config.base;
        },
        resolveId(source) {
            const path = shippedPath(source, version);
            return path === null ? null : { id: `${base}${path}`, external: true };
        },
        generateBundle() {
            if (!emit) {
                return;
            }
            this.emitFile({ type: 'asset', fileName: `assets/shiki-${version}/wasm.mjs`, source: readFileSync(wasm) });

            for (const [kind, folder] of Object.entries(folders)) {
                for (const name of shippedFiles(readdirSync(folder))) {
                    this.emitFile({ type: 'asset', fileName: `assets/shiki-${version}/${kind}/${name}`, source: readFileSync(join(folder, name)) });
                }
            }
        }
    };
}
