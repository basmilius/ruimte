import type { Plugin } from 'vite';
import { START_SCREEN_MODULES } from './start-screen-modules.ts';

const ADECORE = String.raw`(?:@adecore|adecore/packages)`;
const CLIENT_SOURCE = '/apps/client/src/';

/*
 * What only a workspace draws with outside the client's own sources: the editor, the drawing painters
 * and shiki's grammars. The start screen is the first load, so none of it may be in what `index.html`
 * preloads. The editor's key table and view state stay allowed: the application menu shows its keys
 * from the start, and moving a file moves what its editor remembers. So does the language id table, a
 * few lines without imports that the wire contracts name editor assist rules from.
 */
export const WORKSPACE_MODULES: readonly RegExp[] = [
    new RegExp(`${ADECORE}/(?:editor-core|merge|database)/`),
    new RegExp(`${ADECORE}/lsp/src/(?!language-ids\\.ts$)`),
    new RegExp(`${ADECORE}/editor/src/(?!keymap-table\\.ts$)`),
    new RegExp(`${ADECORE}/editor-react/src/(?!view-state\\.ts$)`),
    new RegExp(`${ADECORE}/(?:drawing|diagram)/src/svg\\.ts$`),
    /\/node_modules\/(?:roughjs|perfect-freehand|@shikijs\/(?:langs|themes|engine-oniguruma))\//,
    /\/assets\/shiki-[^/]+\//
];

interface BundleChunk {
    type: 'chunk';
    isEntry: boolean;
    imports: readonly string[];
    modules: Record<string, { renderedLength: number }>;
}

type BundleFile = BundleChunk | { type: 'asset' };

/* A module of the client as the start screen's list names it: its path under `src`, without a query. Null outside the client's sources. */
function clientPath(id: string): string | null {
    const at = id.lastIndexOf(CLIENT_SOURCE);

    return at === -1 ? null : id.slice(at + CLIENT_SOURCE.length).replace(/\?.*$/, '');
}

/*
 * Every module in the chunks an entry preloads (the entry and what it imports statically, as built) that the
 * start screen may not load: a workspace module of a package, or a client module missing from the start
 * screen's list. A client module joins that list only by a decision, so whatever reaches the first load
 * by a stray static import fails the build, whichever folder it is in.
 */
export function preloadedWorkspaceModules(bundle: Record<string, BundleFile>, allowed: readonly string[] = START_SCREEN_MODULES): string[] {
    const listed = new Set(allowed);
    const seen = new Set<string>();
    const queue = Object.entries(bundle)
        .filter(([, file]) => file.type === 'chunk' && file.isEntry)
        .map(([name]) => name);
    const found: string[] = [];
    while (queue.length > 0) {
        const name = queue.shift()!;
        const file = bundle[name];
        if (seen.has(name) || file?.type !== 'chunk') {
            continue;
        }
        seen.add(name);
        queue.push(...file.imports);

        for (const imported of file.imports) {
            if (WORKSPACE_MODULES.some((pattern) => pattern.test(imported))) {
                found.push(`${name}: ${imported}`);
            }
        }

        for (const [id, module] of Object.entries(file.modules)) {
            if (module.renderedLength === 0) {
                continue;
            }

            const path = clientPath(id);

            if (path === null ? WORKSPACE_MODULES.some((pattern) => pattern.test(id)) : !listed.has(path)) {
                found.push(`${name}: ${id}`);
            }
        }
    }
    return found;
}

export function startChunkGuard(): Plugin {
    return {
        name: 'ruimte-start-chunk',
        apply: 'build',
        generateBundle(_options, bundle) {
            const found = preloadedWorkspaceModules(bundle as Record<string, BundleFile>);
            if (found.length > 0) {
                this.error(
                    `The start screen preloads modules it may not load. Load a workspace module where the workspace needs it, or add a module the start screen needs to \`start-screen-modules.ts\`:\n${found.join('\n')}`
                );
            }
        }
    };
}
