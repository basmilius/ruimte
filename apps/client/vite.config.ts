import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { build, defaultClientConditions, defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite';
import { adecoreSources } from './adecore-sources.ts';

// The dev daemon sits on 4211 so an installed Ruimte can keep 4210.
const daemon = process.env.RUIMTE_DAEMON ?? 'ws://localhost:4211';

// Beside the daemons instead of Vite's 5173, which other projects on the same computer claim first.
const port = 4212;

// Where the @adecore packages really live: a linked checkout sits outside this repository.
const clientManifest = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as {
    dependencies: Record<string, string>;
};
const adecore = Object.keys(clientManifest.dependencies)
    .filter((name) => name.startsWith('@adecore/'))
    .map((name) => fileURLToPath(new URL(`./node_modules/${name}`, import.meta.url)))
    .filter(existsSync)
    .map((path) => searchForWorkspaceRoot(realpathSync(path)));

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
 * page builds the same path from pdf.js's `version` (`src/shell/panels/PdfFile.tsx`). QuickJS runs a
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
                const [folder, name, ...rest] = relative.split('/');
                const file = folder !== undefined && name !== undefined ? join(root, folder, name) : null;
                if (file === null || rest.length > 0 || !folders.includes(folder ?? '') || !shipped(name ?? '') || !existsSync(file)) {
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

export default defineConfig(({ mode }) => ({
    plugins: [adecoreSources(), react(), tailwindcss(), bytesWorker(), pdfjsAssets(), ...(mode === 'station' ? [stationHead()] : [])],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        },
        // The library's `source` export is its TypeScript, compiled here like the app's own.
        conditions: ['source', ...defaultClientConditions],
        // A linked checkout has its own node_modules; a second React or i18next breaks every hook and every word.
        dedupe: ['react', 'react-dom', 'i18next', 'react-i18next', '@base-ui-components/react']
    },
    optimizeDeps: {
        // Source exports in the shared React packages are TSX and can import CommonJS dependencies.
        extensions: ['.tsx'],
        include: ['@base-ui-components/react/menu', '@base-ui-components/react/dialog', 'lucide-react', 'clsx']
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
        proxy: {
            // Keep the client same-origin in development; `RUIMTE_DAEMON` can target another daemon.
            '/ws': {
                target: daemon,
                ws: true
            },
            // A browser signs in over HTTP before opening its authenticated socket.
            '/auth': {
                target: daemon.replace(/^ws/, 'http')
            },
            // A project's icon is bytes on the daemon, never a data URL on the wire.
            '/projects': {
                target: daemon.replace(/^ws/, 'http')
            },
            // The same for an image the file viewer draws.
            '/fs': {
                target: daemon.replace(/^ws/, 'http')
            },
            // And for a file someone attached to a message; the bytes stay on the daemon.
            '/attachments': {
                target: daemon.replace(/^ws/, 'http')
            },
            // Browser and simulator pixels stay off the JSON control socket.
            '/live-stream': {
                target: daemon.replace(/^ws/, 'http')
            }
        }
    }
}));
