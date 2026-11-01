import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
    EXTENSION_API_VERSION,
    EXTENSION_ICON_PATH,
    ExtensionManifestSchema,
    ExtensionThemeSchema,
    extensionThemeCssProblem,
    type ExtensionManifest,
    type ExtensionPack
} from '@ruimte/contracts';
import type { BunPlugin } from 'bun';

export const BUILD_FOLDER = 'dist';

// What Ruimte itself supplies, so ten extensions do not carry ten copies, and nothing of it reaches npm.
const CLIENT_HOSTED: Readonly<Record<string, string>> = {
    react: 'react',
    'react/jsx-runtime': 'jsxRuntime',
    'react/jsx-dev-runtime': 'jsxRuntime',
    'react-dom': 'reactDom',
    '@ruimte/extension/client': 'client',
    '@ruimte/extension/ui': 'ui'
};
const SERVER_HOSTED: Readonly<Record<string, string>> = { '@ruimte/extension/server': 'server' };
const MAX_ICON_BYTES = 64 * 1024;
const COPIED_FOLDERS = ['locales', 'assets', 'views', 'themes'];

export class ExtensionBuildError extends Error {}

export function readManifest(folder: string): ExtensionManifest {
    const path = join(folder, 'manifest.json');

    if (!existsSync(path)) {
        throw new ExtensionBuildError(`No manifest.json in ${folder}`);
    }

    const parsed = ExtensionManifestSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));

    if (!parsed.success) {
        throw new ExtensionBuildError(`manifest.json: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
    }

    if (parsed.data.api !== EXTENSION_API_VERSION) {
        throw new ExtensionBuildError(`manifest.json asks for API ${parsed.data.api}; this Ruimte has ${EXTENSION_API_VERSION}`);
    }

    return parsed.data;
}

function checkIcon(root: string): void {
    const file = join(root, EXTENSION_ICON_PATH);

    if (!existsSync(file)) {
        return;
    }

    if (statSync(file).size > MAX_ICON_BYTES) {
        throw new ExtensionBuildError(`${EXTENSION_ICON_PATH} is over ${MAX_ICON_BYTES / 1024} KB`);
    }

    if (!/<svg[\s>]/.test(readFileSync(file, 'utf8'))) {
        throw new ExtensionBuildError(`${EXTENSION_ICON_PATH} is not an svg`);
    }
}

function checkThemes(root: string, manifest: ExtensionManifest): void {
    for (const path of manifest.themes ?? []) {
        const file = join(root, path);

        if (!existsSync(file)) {
            throw new ExtensionBuildError(`manifest.json names ${path}, which does not exist`);
        }

        const theme = ExtensionThemeSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));

        if (!theme.success) {
            throw new ExtensionBuildError(`${path}: ${theme.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join(', ')}`);
        }

        if (theme.data.css !== undefined) {
            const problem = extensionThemeCssProblem(readFileSync(join(root, theme.data.css), 'utf8'));

            if (problem !== null) {
                throw new ExtensionBuildError(`${theme.data.css}: ${problem}`);
            }
        }
    }
}

function entryIn(folder: string): string | null {
    return ['index.ts', 'index.tsx'].map((name) => join(folder, name)).find((path) => existsSync(path)) ?? null;
}

/* Leaves what Ruimte supplies out of the bundle, and keeps `client/` and `server/` apart: they run in different places, so only types cross. */
function hostPlugin(id: string, hosted: Readonly<Record<string, string>>, forbidden: string, part: string, violations: string[]): BunPlugin {
    return {
        name: 'ruimte-extension-host',
        setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
                if (hosted[args.path] !== undefined) {
                    return { path: args.path, namespace: 'ruimte-host' };
                }

                if (args.path.startsWith('.') && args.importer !== '') {
                    const target = resolve(dirname(args.importer), args.path);

                    if (target === forbidden || target.startsWith(`${forbidden}${sep}`)) {
                        violations.push(
                            `${relative(process.cwd(), args.importer)} imports ${args.path}: ${part} may only share types with it. Use \`import type\`, or move shared code to shared/.`
                        );
                    }
                }

                return undefined;
            });
            build.onLoad({ filter: /.*/, namespace: 'ruimte-host' }, (args) => ({
                // CommonJS, so a named import reads a property when it runs and no list of names is needed here.
                contents: `module.exports = globalThis.__ruimteExtension.for(${JSON.stringify(id)}).${hosted[args.path]};`,
                loader: 'js'
            }));
        }
    };
}

async function bundle(
    entry: string,
    outdir: string,
    target: 'browser' | 'bun',
    plugin: BunPlugin,
    violations: readonly string[],
    banner?: string
): Promise<void> {
    const result = await Bun.build({
        entrypoints: [entry],
        outdir,
        target,
        format: 'esm',
        // Never minified: a person reads every version in the store's review.
        minify: false,
        splitting: true,
        naming: { entry: 'index.js', chunk: 'chunks/[name]-[hash].js', asset: 'assets/[name]-[hash].[ext]' },
        define: { 'process.env.NODE_ENV': '"production"' },
        jsx: { runtime: 'automatic', development: false },
        plugins: [plugin],
        ...(banner === undefined ? {} : { banner }),
        throw: false
    });

    // Collected, since a throw inside a resolve hook does not fail the build.
    if (violations.length > 0) {
        throw new ExtensionBuildError(violations.join('\n'));
    }

    if (!result.success) {
        throw new ExtensionBuildError(result.logs.map((log) => String(log)).join('\n'));
    }
}

/* Builds a project into `<folder>/dist`, as a pack holds it and a dev link reads it. */
export async function buildExtension(folder: string): Promise<{ manifest: ExtensionManifest; outdir: string }> {
    // Real, since a bundler names importers by their real path and a temporary folder may be a link.
    const root = realpathSync(resolve(folder));
    const manifest = readManifest(root);
    const outdir = join(root, BUILD_FOLDER);
    const clientEntry = entryIn(join(root, 'client'));
    const serverEntry = entryIn(join(root, 'server'));

    rmSync(outdir, { recursive: true, force: true });
    mkdirSync(outdir, { recursive: true });

    if (clientEntry === null && serverEntry === null && (manifest.themes ?? []).length === 0) {
        throw new ExtensionBuildError('An extension needs client/index.ts, server/index.ts or a theme');
    }

    const violations: string[] = [];

    if (clientEntry !== null) {
        await bundle(
            clientEntry,
            join(outdir, 'client'),
            'browser',
            hostPlugin(manifest.id, CLIENT_HOSTED, join(root, 'server'), 'client/', violations),
            violations,
            // Shadows the page's, so what an extension in development logs also reaches its terminal.
            `const console = globalThis.__ruimteExtension.for(${JSON.stringify(manifest.id)}).console;`
        );
    }

    if (serverEntry !== null) {
        await bundle(
            serverEntry,
            join(outdir, 'server'),
            'bun',
            hostPlugin(manifest.id, SERVER_HOSTED, join(root, 'client'), 'server/', violations),
            violations
        );
    }

    checkThemes(root, manifest);
    checkIcon(root);
    cpSync(join(root, 'manifest.json'), join(outdir, 'manifest.json'));

    for (const name of COPIED_FOLDERS) {
        if (existsSync(join(root, name))) {
            cpSync(join(root, name), join(outdir, name), { recursive: true });
        }
    }

    return { manifest, outdir };
}

function filesIn(folder: string, prefix = ''): string[] {
    return readdirSync(folder).flatMap((name) => {
        const path = `${prefix}${name}`;

        return statSync(join(folder, name)).isDirectory() ? filesIn(join(folder, name), `${path}/`) : [path];
    });
}

export interface PackedExtension {
    manifest: ExtensionManifest;
    path: string;
    bytes: number;
    sha256: string;
}

/* A `.rex` is gzipped JSON: nothing beside the runtime is needed to read one, on the shell's side or the machine's. */
export async function packExtension(folder: string): Promise<PackedExtension> {
    const { manifest, outdir } = await buildExtension(folder);
    const pack: ExtensionPack = {
        files: Object.fromEntries(filesIn(outdir).map((path) => [path, readFileSync(join(outdir, path)).toString('base64')]))
    };
    const bytes = gzipSync(JSON.stringify(pack));
    // Beside what it holds: a build empties the folder first, so a pack never takes in an older one.
    const path = join(outdir, `${manifest.id}-${manifest.version}.rex`);

    writeFileSync(path, bytes);

    return { manifest, path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
