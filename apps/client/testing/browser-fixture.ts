import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reactCompilerPlugin } from './react-compiler-transform';

export const clientDirectory = join(import.meta.dir, '..');

// What Vite puts in `import.meta.env` for the client; Bun.build leaves it undefined.
const viteEnv = { 'import.meta.env': JSON.stringify({ DEV: false, PROD: true, MODE: 'test', BASE_URL: '/' }) };

export interface BrowserFixtureOptions {
    /* A script that runs before the bundle, for what has to be in place before React loads (a devtools hook). */
    head?: string;
    /* React's production build, the one a packaged app runs; a measurement of time means nothing on the development build. */
    production?: boolean;
}

export async function withBrowserFixture(
    entryCode: string,
    styles: string,
    run: (view: InstanceType<typeof Bun.WebView>) => Promise<void>,
    options: BrowserFixtureOptions = {}
): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'ruimte-canvas-'));
    let view: InstanceType<typeof Bun.WebView> | null = null;
    let server: ReturnType<typeof Bun.serve> | null = null;
    const assets = new Map<string, Blob>();
    const workers = new Map<string, string>();
    let assetIndex = 0;
    try {
        const entry = join(directory, 'entry.tsx');
        await writeFile(
            entry,
            `
            import React from ${JSON.stringify(join(clientDirectory, 'node_modules/react/index.js'))};
            import { createRoot } from ${JSON.stringify(join(clientDirectory, 'node_modules/react-dom/client.js'))};
            import i18next from ${JSON.stringify(join(clientDirectory, 'node_modules/i18next/dist/esm/i18next.js'))};
            import { UIProvider } from ${JSON.stringify(Bun.resolveSync('@adecore/ui', clientDirectory))};
            await i18next.init({ lng: 'en', resources: { en: { common: { action: { remove: 'Remove', rename: 'Rename' } }, canvas: { menu: { doubleClick: 'Double-click' } } } } });
            ${entryCode}
        `
        );
        const build = await Bun.build({
            entrypoints: [entry],
            target: 'browser',
            conditions: ['source'],
            define: options.production ? { ...viteEnv, 'process.env.NODE_ENV': JSON.stringify('production') } : viteEnv,
            plugins: [
                // The suite tests what ships, which the compiler made.
                reactCompilerPlugin,
                {
                    name: 'fixture-imports',
                    setup(builder) {
                        builder.onResolve({ filter: /^(react|react-dom|react-i18next|i18next)(\/.*)?$/ }, ({ path }) => ({
                            path: Bun.resolveSync(path, clientDirectory)
                        }));
                        // Resolve the shell through its desktop consumer in isolated installs.
                        builder.onResolve({ filter: /^@adecore\/shell\/bridge$/ }, ({ path }) => ({
                            path: Bun.resolveSync(path, join(clientDirectory, '../desktop'))
                        }));
                        builder.onResolve({ filter: /\?(worker|url)$/ }, ({ path, resolveDir }) => ({
                            path: `${Bun.resolveSync(path.replace(/\?(worker|url)$/, ''), resolveDir)}${path.endsWith('?worker') ? '?worker' : '?url'}`,
                            namespace: 'vite-asset'
                        }));
                        builder.onLoad({ filter: /.*/, namespace: 'vite-asset' }, async ({ path }) => {
                            const worker = path.endsWith('?worker');
                            const file = path.replace(/\?(worker|url)$/, '');
                            const route = `/fixture-asset-${assetIndex++}.js`;
                            if (worker) {
                                workers.set(route, file);
                            } else {
                                assets.set(route, new Blob([await readFile(file)], { type: 'text/javascript' }));
                            }
                            return {
                                loader: 'js',
                                contents: worker
                                    ? `export default class extends Worker { constructor(options) { super(${JSON.stringify(route)}, { ...options, type: 'module' }); } }`
                                    : `export default ${JSON.stringify(route)}`
                            };
                        });
                    }
                }
            ]
        });
        if (!build.success) {
            throw new AggregateError(build.logs, 'Could not bundle the canvas fixture');
        }
        for (const [route, file] of workers) {
            const result = await Bun.build({ entrypoints: [file], target: 'browser', define: viteEnv });
            if (!result.success) {
                throw new AggregateError(result.logs, 'Could not bundle the fixture worker');
            }
            assets.set(route, result.outputs[0]!);
        }
        const script = await build.outputs[0]!.text();
        const theme = await readFile(Bun.resolveSync('@adecore/ui/theme.css', clientDirectory), 'utf8');
        server = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch(request) {
                const path = new URL(request.url).pathname;
                const asset = assets.get(path);
                if (asset) {
                    return new Response(asset, { headers: { 'Content-Type': 'text/javascript' } });
                }
                if (path === '/entry.js') {
                    return new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
                }
                return new Response(
                    `<!doctype html><style>${theme}body{margin:0}#root{position:relative;width:800px;height:600px}${styles}</style><div id="root"></div><script>${options.head ?? ''}</script><script>window.errors=[];window.addEventListener("error",event=>window.errors.push(event.message));window.addEventListener("unhandledrejection",event=>window.errors.push(String(event.reason)));</script><script type="module" src="/entry.js"></script>`,
                    { headers: { 'Content-Type': 'text/html' } }
                );
            }
        });
        // SwiftShader makes WebGL fixtures work on headless runners without a GPU.
        view = new Bun.WebView({
            backend: { type: 'chrome', url: false, argv: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
            headless: true,
            dataStore: { directory: join(directory, 'profile') }
        });
        await view.navigate(`http://127.0.0.1:${server.port}`);
        await view.resize(800, 600);
        await view.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const errors = await view.evaluate<string[]>('window.errors');
        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }
        await run(view);
    } finally {
        view?.close();
        await server?.stop(true);
        await rm(directory, { recursive: true, force: true });
    }
}
