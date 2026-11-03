import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
    EXTENSION_API_VERSION,
    EXTENSION_ICON_PATH,
    ExtensionManifestSchema,
    ExtensionThemeSchema,
    extensionThemeCssProblem,
    isSafePackPath,
    MAX_THEME_THUMBNAIL_BYTES,
    type ExtensionManifest,
    type ExtensionPack
} from '@ruimte/contracts';
import type { BunPlugin } from 'bun';

export const BUILD_FOLDER = 'dist';
// A build on its way, and the one it replaced, which neither a watcher nor the source signature counts as a save.
export const STAGING_PREFIX = '.ruimte-build-';

// What Ruimte itself supplies, so ten extensions do not carry ten copies, and nothing of it reaches npm.
const CLIENT_HOSTED: Readonly<Record<string, string>> = {
    react: 'react',
    'react/jsx-runtime': 'jsxRuntime',
    'react/jsx-dev-runtime': 'jsxRuntime',
    'react-dom': 'reactDom',
    '@ruimte/extension/client': 'client',
    '@ruimte/extension/ui': 'ui',
    '@ruimte/extension/charts': 'charts',
    '@ruimte/extension/agents-ui': 'agentsUi'
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

        const thumbnail = join(root, theme.data.thumbnail);

        if (!existsSync(thumbnail)) {
            throw new ExtensionBuildError(`${path} names the thumbnail ${theme.data.thumbnail}, which does not exist`);
        }

        if (statSync(thumbnail).size > MAX_THEME_THUMBNAIL_BYTES) {
            throw new ExtensionBuildError(`${theme.data.thumbnail} is over ${MAX_THEME_THUMBNAIL_BYTES / 1024} KB`);
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

function realPathOf(path: string): string {
    return existsSync(path) ? realpathSync(path) : path;
}

/*
 * Leaves what Ruimte supplies out of the bundle, and keeps `client/` and `server/` apart: they run in different places, so
 * only types cross. Checked on every file the bundle loads, by its real path, so no absolute import, alias or link
 * carries `server/` and its secrets into the public client bundle.
 */
function hostPlugin(id: string, hosted: Readonly<Record<string, string>>, forbidden: string, part: string, violations: string[]): BunPlugin {
    const forbiddenFolder = realPathOf(forbidden);

    return {
        name: 'ruimte-extension-host',
        setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => (hosted[args.path] !== undefined ? { path: args.path, namespace: 'ruimte-host' } : undefined));
            build.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
                const target = realPathOf(args.path);

                if (target === forbiddenFolder || target.startsWith(`${forbiddenFolder}${sep}`)) {
                    violations.push(
                        `${part} bundles ${relative(dirname(forbiddenFolder), target)}: ${part} may only share types with it. Use \`import type\`, or move shared code to shared/.`
                    );
                }

                return undefined;
            });
            build.onLoad({ filter: /.*/, namespace: 'ruimte-host' }, (args) => ({
                // CommonJS, so a named import reads a property when it runs and no list of names is needed here. The
                // address names the load the chunk belongs to, which a client hands only what that load may do.
                contents: `module.exports = globalThis.__ruimteExtension.for(${JSON.stringify(id)}, import.meta.url).${hosted[args.path]};`,
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
        // Every stylesheet the code imports lands in one `index.css` beside `index.js`, which the client links.
        naming: { entry: '[name].[ext]', chunk: 'chunks/[name]-[hash].js', asset: 'assets/[name]-[hash].[ext]' },
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
    // Beside `dist`, which the version in use reads until this build is whole: a build that fails leaves it as it was.
    const staging = join(root, `${STAGING_PREFIX}${randomUUID()}`);

    try {
        await buildInto(root, manifest, staging);
        swapInto(root, staging, outdir);
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }

    return { manifest, outdir };
}

/* Two renames, so `dist` is missing only between them and never half built. */
function swapInto(root: string, staging: string, outdir: string): void {
    const previous = join(root, `${STAGING_PREFIX}${randomUUID()}`);

    if (existsSync(outdir)) {
        renameSync(outdir, previous);
    }

    renameSync(staging, outdir);
    rmSync(previous, { recursive: true, force: true });
}

async function buildInto(root: string, manifest: ExtensionManifest, outdir: string): Promise<void> {
    const clientEntry = entryIn(join(root, 'client'));
    const serverEntry = entryIn(join(root, 'server'));

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
            `const console = globalThis.__ruimteExtension.for(${JSON.stringify(manifest.id)}, import.meta.url).console;`
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

    copyFileSync(join(root, 'manifest.json'), join(outdir, 'manifest.json'));

    for (const name of COPIED_FOLDERS) {
        if (existsSync(join(root, name))) {
            copyMaterialized(root, name, outdir);
        }
    }

    // Wherever the manifest names them, so what was checked is what the pack holds.
    for (const path of declaredFiles(root, manifest)) {
        if (!existsSync(join(outdir, path))) {
            copyMaterialized(root, path, outdir);
        }
    }

    checkThemes(outdir, manifest);
    checkIcon(outdir);
}

/* Each theme the manifest names, its thumbnail and its stylesheet, as paths inside the project. */
function declaredFiles(root: string, manifest: ExtensionManifest): string[] {
    return (manifest.themes ?? []).flatMap((path) => {
        if (!isSafePackPath(path) || !existsSync(join(root, path))) {
            throw new ExtensionBuildError(`manifest.json names ${path}, which does not exist`);
        }

        const theme = ExtensionThemeSchema.safeParse(JSON.parse(readFileSync(join(root, path), 'utf8')));

        if (!theme.success) {
            throw new ExtensionBuildError(`${path}: ${theme.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join(', ')}`);
        }

        const files = [path, theme.data.thumbnail, ...(theme.data.css === undefined ? [] : [theme.data.css])];
        const outside = files.find((file) => !isSafePackPath(file));

        if (outside !== undefined) {
            throw new ExtensionBuildError(`${path} names ${outside}, which is outside the project`);
        }

        return files.filter((file) => existsSync(join(root, file)));
    });
}

/*
 * Copies `path` of the project into `outdir` as plain files, the way a pack holds them: a link becomes what it points
 * at, which must be inside the project, and a link back into a folder it is in stops the build rather than the copy.
 */
function copyMaterialized(root: string, path: string, outdir: string, visiting: ReadonlySet<string> = new Set()): void {
    const source = join(root, path);
    const real = realpathSync(source);

    if (real !== root && !real.startsWith(`${root}${sep}`)) {
        throw new ExtensionBuildError(`${path} links to ${real}, outside the project`);
    }

    const target = join(outdir, path);

    if (!statSync(real).isDirectory()) {
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(real, target);

        return;
    }

    if ([...visiting].some((folder) => folder === real || folder.startsWith(`${real}${sep}`))) {
        throw new ExtensionBuildError(`${path} links back into a folder it is in`);
    }

    mkdirSync(target, { recursive: true });

    for (const name of readdirSync(source)) {
        copyMaterialized(root, `${path}/${name}`, outdir, new Set([...visiting, real]));
    }
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
