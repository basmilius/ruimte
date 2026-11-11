import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAst, type Plugin } from 'vite';

/*
 * How a built-in runs on the public extension API while its code stays in the client's bundle, for the Vite build and
 * the tests alike. A built-in's own files import `@ruimte/extension/*` as any extension does; under its folder those
 * imports are bound to what the client supplies, the client API to `built-in-api.ts` with the built-in's id. Its
 * `client/index.ts`, imported with `?activate`, becomes a function, so turning the built-in on again runs its
 * `define*` calls again, as a new load of an installed extension does.
 */

/* The folders under `extensions/` the client ships, as `src/extensions/built-in.ts` names them. */
export const BUILT_IN_FOLDERS: readonly string[] = ['pets', 'theme-umbra'];

// In forward slashes, as Vite names a module on every platform.
const EXTENSIONS = posix(fileURLToPath(new URL('../../extensions/', import.meta.url)));

export const BUILT_IN_API = posix(fileURLToPath(new URL('./src/extensions/host/built-in-api.ts', import.meta.url)));

const UNBOUND_ID = '= builtInExtensionId();';

// What a pack would rewrite to what the client supplies (`apps/server/src/extensions/pack.ts`).
const HOSTED_PACKAGES: Readonly<Record<string, string>> = {
    ui: posix(fileURLToPath(new URL('./src/extensions/host/extension-ui.ts', import.meta.url))),
    'agents-ui': '@adecore/agents-react/chat/ui',
    charts: '@adecore/charts'
};

const HOSTED_IMPORT = /(["'])@ruimte\/extension\/(client|ui|agents-ui|charts)\1/g;

const ids = new Map<string, string>();

function posix(path: string): string {
    return path.replaceAll('\\', '/');
}

function idOf(folder: string): string {
    let id = ids.get(folder);

    if (id === undefined) {
        id = (JSON.parse(readFileSync(`${EXTENSIONS}${folder}/manifest.json`, 'utf8')) as { id: string }).id;
        ids.set(folder, id);
    }

    return id;
}

/* The built-in a file belongs to, by its folder, or null for any other file. */
export function builtInFolderOf(path: string): string | null {
    if (!path.startsWith(EXTENSIONS)) {
        return null;
    }

    const folder = path.slice(EXTENSIONS.length).split('/')[0] ?? '';

    return BUILT_IN_FOLDERS.includes(folder) ? folder : null;
}

function boundImports(folder: string, code: string): string {
    return code.replace(HOSTED_IMPORT, (_match, quote: string, entry: string) => {
        const target = entry === 'client' ? `${BUILT_IN_API}?extension=${encodeURIComponent(idOf(folder))}` : HOSTED_PACKAGES[entry];

        return `${quote}${target}${quote}`;
    });
}

/*
 * The entry as a function its load calls. An entry only defines what it adds, so it holds imports and statements and
 * exports nothing; any export fails the build, since a load could never reach it.
 */
export function activatedEntry(path: string, code: string): string {
    const program = parseAst(code, { lang: path.endsWith('.tsx') ? 'tsx' : 'ts' });
    let cut = 0;

    for (const statement of program.body) {
        if (statement.type.startsWith('Export')) {
            throw new Error(`${path}: a built-in's entry exports nothing, it only defines what it adds`);
        }

        if (statement.type === 'ImportDeclaration') {
            if (code.slice(cut, statement.start).trim() !== '') {
                throw new Error(`${path}: a built-in's entry keeps its imports above everything else`);
            }

            cut = statement.end;
        }
    }

    return `${code.slice(0, cut)}\nexport default function activate(): void {${code.slice(cut)}\n}\n`;
}

/* A module as the client runs it: a file of a built-in with its imports bound, its entry made a function, the API bound to its id. */
export function builtInModule(id: string, code: string): string | null {
    const [file = id, query = ''] = id.split('?');
    const path = posix(file);
    const params = new URLSearchParams(query);

    if (path === BUILT_IN_API) {
        const extension = params.get('extension');

        return extension === null ? null : code.replace(UNBOUND_ID, `= ${JSON.stringify(extension)};`);
    }

    const folder = builtInFolderOf(path);

    if (folder === null) {
        return null;
    }

    const bound = boundImports(folder, code);

    return params.has('activate') ? activatedEntry(path, bound) : bound;
}

/* The same for the Vite build, before TypeScript is stripped. */
export function builtInExtensions(): Plugin {
    return {
        name: 'ruimte-built-in-extensions',
        enforce: 'pre',
        transform(code, id) {
            const module = builtInModule(id, code);

            return module === null ? null : { code: module, map: null };
        }
    };
}
