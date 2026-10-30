import type { Plugin } from 'vite';

const ADECORE = String.raw`(?:@adecore|adecore/packages)`;

/*
 * What only a workspace draws with: the editor, the drawing painters, the SQL console and shiki's
 * grammars. The start screen is the first load, so none of it may be in what `index.html` preloads.
 * The editor's key table and view state stay allowed: the application menu shows its keys from the
 * start, and moving a file moves what its editor remembers.
 */
export const WORKSPACE_MODULES: readonly RegExp[] = [
    /\/src\/shell\/(?:WorkspaceShell\.tsx|commands\.ts)$/,
    new RegExp(`${ADECORE}/(?:editor-core|lsp|merge|database)/`),
    new RegExp(`${ADECORE}/editor/src/(?!keymap-table\\.ts$)`),
    new RegExp(`${ADECORE}/editor-react/src/(?!view-state\\.ts$)`),
    new RegExp(`${ADECORE}/(?:drawing|diagram)/src/svg\\.ts$`),
    /\/node_modules\/(?:roughjs|perfect-freehand|@shikijs\/(?:langs|themes|engine-oniguruma))\//,
    /\/assets\/shiki-[^/]+\//,
    /\/src\/(?:drawing\/(?:export|paint)|diagram\/export|database\/(?:console-file|sql-bindings))\.ts$/
];

interface BundleChunk {
    type: 'chunk';
    isEntry: boolean;
    imports: readonly string[];
    modules: Record<string, { renderedLength: number }>;
}

type BundleFile = BundleChunk | { type: 'asset' };

/* Every workspace module in the chunks an entry preloads: the entry and what it imports statically, as built. */
export function preloadedWorkspaceModules(bundle: Record<string, BundleFile>): string[] {
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
            if (module.renderedLength > 0 && WORKSPACE_MODULES.some((pattern) => pattern.test(id))) {
                found.push(`${name}: ${id}`);
            }
        }
    }
    return found;
}

/* Fails a build whose start screen would preload a workspace module, with the chunk and the module that brought it. */
export function startChunkGuard(): Plugin {
    return {
        name: 'ruimte-start-chunk',
        apply: 'build',
        generateBundle(_options, bundle) {
            const found = preloadedWorkspaceModules(bundle as Record<string, BundleFile>);
            if (found.length > 0) {
                this.error(`The start screen preloads workspace modules; load them where the workspace needs them:\n${found.join('\n')}`);
            }
        }
    };
}
