import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { normalizePath, type Plugin, type ViteDevServer } from 'vite';

export function adecoreSources(): Plugin {
    const stylesheets = new Map<string, Set<string>>();
    let server: ViteDevServer | undefined;
    return {
        name: 'ruimte-adecore-sources',
        apply: 'serve',
        enforce: 'pre',
        configureServer(value) {
            server = value;
        },
        transform: {
            filter: { id: /\.css(?:\?.*)?$/ },
            handler(code, id) {
                const file = id.split('?')[0]!;
                const folder = dirname(file);
                const sources = new Set<string>();
                const transformed = code.replace(/^@source (["'])(\.\.\/node_modules\/@adecore\/[^"'/]+\/src)\1;/gm, (directive, _quote, path: string) => {
                    const source = resolve(folder, path);
                    if (!existsSync(source)) {
                        return directive;
                    }
                    // Tailwind's watched dependencies must match the real paths Vite uses for linked modules.
                    const actual = normalizePath(realpathSync(source));
                    sources.add(actual);
                    server?.watcher.add(actual);
                    return `@source ${JSON.stringify(actual)};`;
                });
                stylesheets.set(normalizePath(file), sources);
                return transformed;
            }
        },
        hotUpdate({ file, modules }) {
            const changed = normalizePath(file);
            const affected = new Set(modules);
            for (const [stylesheet, sources] of stylesheets) {
                if (![...sources].some((source) => changed.startsWith(`${source}/`))) {
                    continue;
                }
                // New and unloaded files have no JS importer to invalidate their scanning stylesheet.
                for (const module of this.environment.moduleGraph.getModulesByFile(stylesheet) ?? []) {
                    affected.add(module);
                }
            }
            return [...affected];
        }
    };
}
