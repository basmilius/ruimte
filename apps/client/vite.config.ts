import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import babel from '@rolldown/plugin-babel';
import { CLIENT_DEV_PORT, DEV_PORT } from '@ruimte/service/runtime';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { build, defaultClientConditions, defineConfig, searchForWorkspaceRoot, type Plugin, type PluginOption } from 'vite';
import { adecoreSources } from './adecore-sources.ts';
import { scriptFilesGuard } from './inline-scripts.ts';
import { compiledThroughCache } from './react-compiler-vite.ts';
import { COMPILER_RUNTIME, REACT_COMPILED, REACT_COMPILED_PACKAGES, REACT_COMPILER_LEFT_OUT, REACT_COMPILER_OPTIONS } from './react-compiler.ts';
import { shikiModules, shikiOnce } from './shiki-once.ts';
import { startChunkGuard } from './start-chunk.ts';
import { visualHostPage } from './visual-host.ts';

const daemon = process.env.RUIMTE_DAEMON ?? `ws://localhost:${DEV_PORT}`;

// Only a release reports its errors (`src/telemetry/report.ts`): CI sets both, and with them come the source maps it uploads and never ships.
const telemetryVersion = process.env.RUIMTE_TELEMETRY === '1' ? (process.env.RUIMTE_VERSION ?? '') : '';

const port = CLIENT_DEV_PORT;

// Where the @adecore packages really live: a linked checkout sits outside this repository.
const clientManifest = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as {
    dependencies: Record<string, string>;
};
const adecore = Object.keys(clientManifest.dependencies)
    .filter((name) => name.startsWith('@adecore/'))
    .map((name) => fileURLToPath(new URL(`./node_modules/${name}`, import.meta.url)))
    .filter(existsSync)
    .map((path) => searchForWorkspaceRoot(realpathSync(path)));

const uiSource = realpathSync(fileURLToPath(new URL('./node_modules/@adecore/ui/src', import.meta.url))) + sep;

/* The TypeScript of ADE CORE's React packages, linked or from npm, as globs the dependency scan starts from. */
const reactCompiledSources = REACT_COMPILED_PACKAGES.map((name) => fileURLToPath(new URL(`./node_modules/${name}`, import.meta.url)))
    .filter(existsSync)
    .map((path) => `${realpathSync(path)}/src`)
    .flatMap((source) => [`${source}/**/*.{ts,tsx}`, `!${source}/**/*.test.{ts,tsx}`, `!${source}/testing/**`, `!${source}/**/test-support.ts`]);

/*
 * The web client at `station.ruimte.app` (`vite build --mode station`). It is the same page, plus what
 * lets a person put it on a Home Screen: Safari clears a site's storage after seven days without a
 * visit, and a Home Screen app is exempt, which is where the session and the client key live.
 */
function stationHead(): Plugin {
    return {
        name: 'ruimte-station-head',
        transformIndexHtml: (html) => ({
            // A browser prefers an SVG icon over any PNG, so the page's own mark would win over the app icon.
            html: html.replace(/\s*<link rel="icon" href="\/favicon\.svg"[^>]*>/, ''),
            tags: [
                { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo: 'head' },
                { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }, injectTo: 'head' },
                { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' }, injectTo: 'head' },
                { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16.png' }, injectTo: 'head' },
                { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
                { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'Ruimte' }, injectTo: 'head' },
                // The page runs under the status bar either way on iPadOS; saying so keeps it that way, and `#root` keeps clear of it.
                { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }, injectTo: 'head' }
            ]
        })
    };
}

/*
 * The service worker behind a video over a direct connection (`src/worker/bytes-worker.ts`). A worker
 * only controls the pages under its own folder, so it has to be one classic script at the root and
 * never a hashed chunk under `/assets/`: a small build of its own, served in dev and written beside
 * `index.html`. The page registers it as `BYTES_WORKER_SCRIPT`.
 */
function bytesWorker(): Plugin {
    const fileName = 'bytes-worker.js';
    const bundle = async (): Promise<string> => {
        const result = await build({
            configFile: false,
            root: fileURLToPath(new URL('.', import.meta.url)),
            publicDir: false,
            logLevel: 'warn',
            resolve: { conditions: ['source', ...defaultClientConditions] },
            build: {
                write: false,
                rolldownOptions: { input: fileURLToPath(new URL('./src/worker/bytes-worker.ts', import.meta.url)), output: { format: 'iife' } }
            }
        });
        const output = Array.isArray(result) ? result[0] : result;
        if (!output || !('output' in output)) {
            throw new Error('The bytes worker did not build');
        }
        return output.output[0].code;
    };
    return {
        name: 'ruimte-bytes-worker',
        configureServer: (server) => {
            server.middlewares.use(`/${fileName}`, (_request, response, next) => {
                bundle().then((code) => {
                    response.setHeader('content-type', 'text/javascript');
                    response.setHeader('cache-control', 'no-cache');
                    response.end(code);
                }, next);
            });
        },
        async generateBundle() {
            this.emitFile({ type: 'asset', fileName, source: await bundle() });
        }
    };
}

/*
 * What pdf.js fetches by folder and file name while it reads a PDF: the wasm decoders, the standard
 * fonts, the character maps and the color profile. Hashed names would break that lookup, so they keep
 * their own under a folder named after the version, served in dev and written beside the chunks. The
 * page builds the same path from pdf.js's `version` (`src/files/PdfFile.tsx`). QuickJS runs a
 * PDF's own scripts, which this viewer never does, so it stays out.
 */
function pdfjsAssets(): Plugin {
    const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
    const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;
    const base = `assets/pdfjs-${version}`;
    const folders = ['cmaps', 'iccs', 'standard_fonts', 'wasm'];
    const shipped = (name: string): boolean => !name.startsWith('quickjs');
    return {
        name: 'ruimte-pdfjs-assets',
        configureServer: (server) => {
            server.middlewares.use(`/${base}`, (request, response, next) => {
                const relative = normalize(decodeURIComponent((request.url ?? '').split('?')[0] ?? '')).replace(/^[/\\]+/, '');
                const [folder = '', name = '', ...rest] = relative.split('/');
                const file = join(root, folder, name);
                if (rest.length > 0 || !folders.includes(folder) || name === '' || !shipped(name) || !existsSync(file)) {
                    next();
                    return;
                }
                const type = file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
                response.setHeader('content-type', type);
                response.end(readFileSync(file));
            });
        },
        generateBundle() {
            for (const folder of folders) {
                for (const name of readdirSync(join(root, folder)).filter(shipped)) {
                    this.emitFile({ type: 'asset', fileName: `${base}/${folder}/${name}`, source: readFileSync(join(root, folder, name)) });
                }
            }
        }
    };
}

/*
 * The React Compiler (`react-compiler.ts` says over what). The Babel plugin, since the native compiler
 * of the Vite React plugin is still experimental; Babel 7, since 8 bails on every destructuring default.
 */
function reactCompiler(): PluginOption[] {
    const compiler = compiledThroughCache(
        babel({
            presets: [reactCompilerPreset(REACT_COMPILER_OPTIONS)],
            include: REACT_COMPILED,
            // In place of the default, which leaves out everything under `node_modules`, where the packages sit when they come from npm.
            exclude: [...REACT_COMPILER_LEFT_OUT, /^\0rolldown\/runtime\.js$/]
        })
    );
    const runtime: Plugin = {
        name: 'ruimte-compiler-runtime',
        enforce: 'pre',
        resolveId: {
            filter: { id: /^react\/compiler-runtime$/ },
            handler: (_source, importer) => (importer === COMPILER_RUNTIME ? null : COMPILER_RUNTIME)
        }
    };
    return [compiler, runtime];
}

const shiki = shikiModules();

/*
 * The model comparison alone at `bench.ruimte.app` (`vite build --mode bench`), from `bench.html`. It has
 * no workspace, video or visual to serve, so the plugins that write those stay out of its build.
 */
export default defineConfig(({ command, mode }) => ({
    experimental: {
        bundledDev: command === 'serve' && process.env.RUIMTE_BUNDLED_DEV !== '0'
    },
    plugins: [
        adecoreSources(),
        react(),
        ...reactCompiler(),
        tailwindcss(),
        ...(mode === 'bench' ? [] : [bytesWorker(), pdfjsAssets(), visualHostPage()]),
        shikiOnce(shiki, true),
        ...(mode === 'bench' ? [] : [startChunkGuard()]),
        scriptFilesGuard(),
        ...(mode === 'station' ? [stationHead()] : [])
    ],
    define: {
        'import.meta.env.RUIMTE_TELEMETRY_VERSION': JSON.stringify(telemetryVersion)
    },
    build: {
        sourcemap: telemetryVersion === '' ? false : 'hidden',
        rolldownOptions: {
            ...(mode === 'bench' ? { input: fileURLToPath(new URL('./bench.html', import.meta.url)) } : {}),
            // In dev, compile lazy features before their first open; production keeps its dynamic imports.
            ...(command === 'serve' ? { experimental: { devMode: { lazy: false } } } : {}),
            output: {
                // Initial code stays together; shared controls otherwise make the workspace fetch many tiny chunks.
                codeSplitting: {
                    groups: [
                        { name: 'startup', tags: ['$initial'] },
                        {
                            name: 'controls',
                            test: (id) => normalize(id).startsWith(uiSource) || /[\\/]node_modules[\\/]@base-ui[\\/]react[\\/]/.test(id)
                        },
                        { name: 'icons', test: /[\\/]node_modules[\\/]lucide-react[\\/]/ }
                    ]
                }
            }
        }
    },
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            '@extensions': fileURLToPath(new URL('../../extensions', import.meta.url))
        },
        // The library's `source` export is its TypeScript, compiled here like the app's own.
        conditions: ['source', ...defaultClientConditions],
        // Linked packages use the app's runtime instances; CodeMirror rejects extensions from a second copy.
        dedupe: [
            'react',
            'react-dom',
            'i18next',
            'react-i18next',
            'zod',
            'zustand',
            '@base-ui/react',
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/language',
            '@codemirror/commands',
            '@lezer/common',
            '@lezer/highlight',
            '@lezer/markdown',
            // One shiki, also when a linked package brings a copy of its own.
            'shiki',
            // One formatter and one file icon override: a second copy, resolved under other peers for a package that
            // imports it, never hears the region or the extensions the client sets.
            '@adecore/ui'
        ]
    },
    worker: {
        // Keep Shiki grammars lazy instead of putting the full catalog into every syntax worker.
        format: 'es',
        plugins: () => [shikiOnce(shiki, false)]
    },
    optimizeDeps: {
        // Source exports in the shared React packages are TSX and can import CommonJS dependencies.
        extensions: ['.tsx'],
        // Those packages are served as modules, so the first start bundles what they import with the app's own instead of reloading the page for each dependency it finds late.
        entries: ['index.html', ...reactCompiledSources],
        // Imported only once a chat draws code or a diagram, which the scan of the entries does not follow.
        include: ['@base-ui/react/menu', '@base-ui/react/dialog', 'lucide-react', 'clsx', 'shiki/bundle/web', '@adecore/agents-react > pele/lazy'],
        exclude: REACT_COMPILED_PACKAGES
    },
    server: {
        port,
        strictPort: true,
        fs: {
            allow: [searchForWorkspaceRoot(process.cwd()), ...adecore]
        },
        // Vite compiles a module on its first request; this does all of them while `bun dev` starts, so the first open is not the slow one.
        warmup: {
            clientFiles: ['./src/**/*.{ts,tsx}', '!./src/**/*.test.{ts,tsx}']
        },
        // Keep the client same-origin in development; `RUIMTE_DAEMON` can target another daemon.
        proxy: {
            '/ws': { target: daemon, ws: true },
            // The shell keeps these (`apps/desktop/src/main/dev-extension-files.ts`).
            '/__extensions': { target: 'http://127.0.0.1:4213' },
            // Signing in, and bytes that stay off the JSON socket: project icons, files, attachments, live pixels.
            ...Object.fromEntries(
                ['/auth', '/projects', '/fs', '/attachments', '/live-stream'].map((path) => [path, { target: daemon.replace(/^ws/, 'http') }])
            )
        }
    }
}));
