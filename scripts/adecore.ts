import { Glob } from 'bun';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
const CATALOG_REFERENCE = 'catalog:';
// The root manifest inside the daemon image; it keeps a catalog of its own because the image never sees the root's.
const DOCKER_MANIFEST = 'apps/server/docker/workspace-package.json';
const REGISTRY = 'https://registry.npmjs.org';
// The registry's CDN can answer 404 for a new tarball for several minutes after the publish.
const REGISTRY_TRIES = 60;
const REGISTRY_PAUSE_MS = 10_000;

export interface Manifest {
    name: string;
    version?: string;
    workspaces?: string[] | { packages: string[]; catalog?: Record<string, string> };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
}

interface Package {
    folder: string;
    manifest: Manifest;
}

interface Dependency {
    consumer: Package;
    name: string;
    version: string;
    path: string;
}

export interface PackageStatus {
    workspace: string;
    name: string;
    version: string;
    target: string | null;
    mode: 'npm' | 'local' | 'other' | 'missing';
}

export interface Registry {
    /** Whether the tarball of this version can be downloaded. */
    has(name: string, version: string): Promise<boolean>;
    pause(): Promise<void>;
}

export type RunCommand = (cwd: string, args: string[]) => Promise<void>;
export type LinkPackage = (path: string, target: string) => void;

export function adecorePath(root: string): string {
    return resolve(root, process.env.ADECORE_PATH ?? '../adecore');
}

function readPackage(folder: string): Package {
    return { folder, manifest: JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as Manifest };
}

function packagesIn(root: string): Package[] {
    const main = readPackage(root);
    const workspaces = main.manifest.workspaces;
    const patterns = (Array.isArray(workspaces) ? workspaces : workspaces?.packages) ?? [];
    const folders = new Set(patterns.flatMap((pattern) => [...new Glob(`${pattern}/package.json`).scanSync({ cwd: root, onlyFiles: true })]));
    return [main, ...[...folders].sort().map((path) => readPackage(join(root, dirname(path))))];
}

function dependenciesOf(manifest: Manifest, peers = false): Record<string, string> {
    return { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...(peers ? manifest.peerDependencies : {}) };
}

export function catalogOf(manifest: Manifest): Record<string, string> {
    const workspaces = manifest.workspaces;

    return Array.isArray(workspaces) ? {} : (workspaces?.catalog ?? {});
}

function consumersIn(root: string): Dependency[] {
    const packages = packagesIn(root);
    const catalog = catalogOf(packages[0].manifest);

    return packages.flatMap((consumer) =>
        Object.entries(dependenciesOf(consumer.manifest))
            .filter(([name]) => name.startsWith('@adecore/'))
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, version]) => ({
                consumer,
                name,
                version: version === CATALOG_REFERENCE ? (catalog[name] ?? version) : version,
                path: join(consumer.folder, 'node_modules', name)
            }))
    );
}

function isInside(root: string, path: string): boolean {
    const child = relative(root, path);
    return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
}

function isInstalled(root: string, target: string): boolean {
    return isInside(root, target) && relative(root, target).split(sep).includes('node_modules');
}

function resolvedFolder(path: string): string | null {
    return existsSync(path) ? realpathSync(path) : null;
}

function snapshot(files: string[]): () => void {
    const contents = new Map(files.map((file) => [file, readFileSync(file)]));
    return () => {
        for (const [file, before] of contents) {
            if (!existsSync(file) || !before.equals(readFileSync(file))) {
                throw new Error(`The command changed ${file}. Review the file before continuing.`);
            }
        }
    };
}

function snapshotManifests(root: string, packages: Package[]): () => void {
    return snapshot([join(root, 'bun.lock'), ...packages.map((pkg) => join(pkg.folder, 'package.json'))]);
}

function linkPlan(root: string, adecore: string): { consumers: Dependency[]; packages: Package[] } {
    const consumers = consumersIn(root);
    const available = new Map(packagesIn(adecore).map((pkg) => [pkg.manifest.name, pkg]));
    const selected = new Map<string, Package>();
    const pending = consumers.map((dep) => dep.name);
    for (const name of pending) {
        if (selected.has(name)) {
            continue;
        }
        const pkg = available.get(name);
        if (!pkg) {
            throw new Error(`${name} is missing from ${adecore}. No links were changed.`);
        }
        selected.set(name, pkg);
        for (const dependency of Object.keys(dependenciesOf(pkg.manifest, true)).filter((dep) => dep.startsWith('@adecore/'))) {
            const local = available.get(dependency);
            if (!local || resolvedFolder(join(pkg.folder, 'node_modules', dependency)) !== realpathSync(local.folder)) {
                throw new Error(`${name} must resolve ${dependency} inside ${adecore}. Run bun install in ADE CORE first.`);
            }
            pending.push(dependency);
        }
        for (const dependency of Object.keys(pkg.manifest.dependencies ?? {})) {
            if (!resolvedFolder(join(pkg.folder, 'node_modules', dependency))) {
                throw new Error(`${name} cannot resolve ${dependency}. Run bun install in ADE CORE first.`);
            }
        }
    }
    for (const dependency of consumers) {
        if (!lstatSync(dependency.path, { throwIfNoEntry: false })?.isSymbolicLink()) {
            throw new Error(`${dependency.path} must be an installed package link. Run bun install in Ruimte first.`);
        }
    }
    return { consumers, packages: [...selected.values()] };
}

async function runBun(cwd: string, args: string[]): Promise<void> {
    const child = Bun.spawn([process.execPath, ...args], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) {
        throw new Error(`bun ${args.join(' ')} failed in ${cwd}\n${stderr || stdout}`);
    }
}

export function replacePackageLink(path: string, target: string): void {
    if (!lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new Error(`${path} is no longer an installed package link.`);
    }
    unlinkSync(path);
    symlinkSync(relative(dirname(path), target), path);
}

export function packageStatus(root: string, adecore: string): PackageStatus[] {
    root = realpathSync(root);
    const local = resolvedFolder(adecore) ?? resolve(adecore);
    return consumersIn(root).map((dep) => {
        const target = resolvedFolder(dep.path);
        const manifest = target !== null && isInstalled(root, target) ? readPackage(target).manifest : null;
        const npm = manifest?.name === dep.name && (!EXACT_VERSION.test(dep.version) || manifest.version === dep.version);
        const mode = target === null ? 'missing' : isInside(local, target) ? 'local' : npm ? 'npm' : 'other';
        return { workspace: relative(root, dep.consumer.folder).split(sep).join('/') || '.', name: dep.name, version: dep.version, target, mode };
    });
}

export function statusMode(status: PackageStatus[]): 'npm' | 'local' | 'mixed' {
    if (status.every((pkg) => pkg.mode === 'npm')) {
        return 'npm';
    }
    if (status.every((pkg) => pkg.mode === 'local')) {
        return 'local';
    }
    return 'mixed';
}

function clearClientCache(root: string): void {
    // Neither manifests nor the lockfile change, so Vite's optimizer may reuse the previous package locations.
    rmSync(join(root, 'apps', 'client', 'node_modules', '.vite'), { recursive: true, force: true });
}

export function linkLocalPackages(root: string, adecore: string, link: LinkPackage = replacePackageLink): void {
    root = realpathSync(root);
    adecore = realpathSync(adecore);
    const plan = linkPlan(root, adecore);
    const unchanged = snapshotManifests(root, packagesIn(root));
    const sourceUnchanged = snapshotManifests(adecore, packagesIn(adecore));
    const aliases = plan.consumers.map((dep) => ({ path: dep.path, target: readlinkSync(dep.path) }));
    try {
        // bun link inside a consumer cannot resolve Ruimte's workspace:* dependencies in Bun 1.4.2.
        const folders = new Map(plan.packages.map((pkg) => [pkg.manifest.name, pkg.folder]));
        for (const dep of plan.consumers) {
            link(dep.path, folders.get(dep.name)!);
        }
        unchanged();
        sourceUnchanged();
        for (const dep of plan.consumers) {
            const expected = folders.get(dep.name)!;
            if (resolvedFolder(dep.path) !== realpathSync(expected)) {
                throw new Error(`${dep.path} does not resolve to ${expected}.`);
            }
        }
        if (statusMode(packageStatus(root, adecore)) !== 'local') {
            throw new Error('The installed ADE CORE packages are mixed or missing.');
        }
        clearClientCache(root);
    } catch (error) {
        // A failed switch restores the previous aliases, including an already active local setup.
        for (const alias of aliases) {
            const current = lstatSync(alias.path, { throwIfNoEntry: false });
            if (!current || current.isSymbolicLink()) {
                if (current) {
                    unlinkSync(alias.path);
                }
                symlinkSync(alias.target, alias.path);
            }
        }
        throw error;
    }
}

export async function restoreNpmPackages(root: string, adecore = adecorePath(root), run: RunCommand = runBun): Promise<void> {
    root = realpathSync(root);
    const unchanged = snapshotManifests(root, packagesIn(root));
    // Bun install restores declared versions even while local package links are present.
    await run(root, ['install', '--frozen-lockfile']);
    unchanged();
    if (statusMode(packageStatus(root, adecore)) !== 'npm') {
        throw new Error('Some ADE CORE packages still resolve outside the npm install. Run adecore:status to inspect them.');
    }
    clearClientCache(root);
}

function adecoreEntries(entries: Record<string, string> | undefined): [string, string][] {
    return Object.entries(entries ?? {}).filter(([name]) => name.startsWith('@adecore/'));
}

/**
 * What stops a package from taking its ADE CORE version from the root catalog: a pin of its own, a
 * name the catalog lacks, or a catalog entry that is no exact version.
 */
export function catalogProblems(root: string): string[] {
    const packages = packagesIn(root);
    const catalog = catalogOf(packages[0].manifest);
    const problems = adecoreEntries(catalog)
        .filter(([, version]) => !EXACT_VERSION.test(version))
        .map(([name, version]) => `package.json: the catalog entry ${name} is "${version}", not an exact version`);

    for (const pkg of packages) {
        const file = `${relative(root, pkg.folder) || '.'}/package.json`;

        for (const section of DEPENDENCY_SECTIONS) {
            for (const [name, version] of adecoreEntries(pkg.manifest[section])) {
                if (version !== CATALOG_REFERENCE) {
                    problems.push(`${file}: ${name} in ${section} is "${version}", not "${CATALOG_REFERENCE}"`);
                } else if (!(name in catalog)) {
                    problems.push(`${file}: ${name} in ${section} is missing from the catalog in package.json`);
                }
            }
        }
    }

    return problems;
}

/**
 * The daemon image installs from a root manifest of its own, so its catalog has to say what the root's says.
 */
export function dockerCatalogDrift(root: string): string[] {
    const file = join(root, DOCKER_MANIFEST);

    if (!existsSync(file)) {
        return [];
    }

    const expected = catalogOf(readPackage(root).manifest);
    const actual = catalogOf(JSON.parse(readFileSync(file, 'utf8')) as Manifest);

    return [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
        .sort()
        .filter((name) => expected[name] !== actual[name])
        .map((name) => `${DOCKER_MANIFEST}: ${name} is ${actual[name] ?? 'missing'}, the root catalog has ${expected[name] ?? 'no entry'}`);
}

/**
 * Rewrites the text rather than serializing the parsed manifest, so the file keeps its own layout.
 */
export function bumpCatalog(text: string, version: string, file = 'package.json'): { text: string; names: string[] } {
    const manifest = JSON.parse(text) as Manifest;
    const entries = adecoreEntries(catalogOf(manifest));

    for (const [name, pinned] of entries) {
        if (!EXACT_VERSION.test(pinned)) {
            throw new Error(`${file}: the catalog entry ${name} is "${pinned}", not an exact version. No manifest was changed.`);
        }
    }

    const names = entries.map(([name]) => name);
    const expected = structuredClone(manifest);

    for (const name of names) {
        (expected.workspaces as { catalog: Record<string, string> }).catalog[name] = version;
    }

    let next = text;

    for (const name of names) {
        const key = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
        next = next.replace(new RegExp(`("${key}"\\s*:\\s*")[^"]*(")`, 'g'), `$1${version}$2`);
    }

    if (!Bun.deepEquals(JSON.parse(next), expected, true)) {
        throw new Error(`${file}: the ADE CORE catalog could not be rewritten without touching other fields. No manifest was changed.`);
    }

    return { text: next, names };
}

/**
 * A release is on npm one package at a time, and an install in between would leave node_modules half bumped.
 */
export async function awaitRelease(names: string[], version: string, registry: Registry, tries = REGISTRY_TRIES): Promise<void> {
    let missing = names;

    for (let attempt = 1; ; attempt++) {
        const found = await Promise.all(missing.map((name) => registry.has(name, version)));
        missing = missing.filter((_, i) => !found[i]);

        if (missing.length === 0) {
            return;
        }

        if (attempt >= tries) {
            throw new Error(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not on npm at ${version} after ${tries} tries. No file was changed.`);
        }

        await registry.pause();
    }
}

const npmRegistry: Registry = {
    async has(name, version) {
        const short = name.slice('@adecore/'.length);

        try {
            const response = await fetch(`${REGISTRY}/${name}/-/${short}-${version}.tgz`, { method: 'HEAD' });

            return response.status === 200;
        } catch {
            // A network hiccup counts as not there yet; the tries bound the wait.
            return false;
        }
    },
    pause: () => Bun.sleep(REGISTRY_PAUSE_MS)
};

export function lockedOffVersion(lock: string, version: string): string[] {
    const locked = new Set(
        [...lock.matchAll(/"(@adecore\/[\w.-]+)@([^"]+)"/g)].filter((match) => match[2] !== version).map((match) => `${match[1]}@${match[2]}`)
    );
    return [...locked].sort();
}

export async function bumpPackages(root: string, adecore: string, version: string, run: RunCommand = runBun, registry: Registry = npmRegistry): Promise<void> {
    if (!EXACT_VERSION.test(version)) {
        throw new Error(`${version} is not an exact version such as 0.24.0.`);
    }
    root = realpathSync(root);
    // An install in a linked checkout swaps every link back to npm, so a bump would end the link without saying so.
    const linked = packageStatus(root, adecore).filter((pkg) => pkg.mode === 'local' || (pkg.target !== null && !isInstalled(root, pkg.target)));
    if (linked.length > 0) {
        throw new Error(
            `${linked[0].workspace}: ${linked[0].name} is linked to ${linked[0].target}. Run bun run adecore:npm first, bump, then bun run adecore:link to continue on the local folder.`
        );
    }
    const problems = catalogProblems(root);
    if (problems.length > 0) {
        throw new Error(`Every ADE CORE dependency takes its version from the catalog. No file was changed:\n  ${problems.join('\n  ')}`);
    }
    const lockfile = join(root, 'bun.lock');
    const manifests = [join(root, 'package.json'), join(root, DOCKER_MANIFEST)].filter((file) => existsSync(file));
    const before = new Map([lockfile, ...manifests].map((file) => [file, readFileSync(file, 'utf8')]));
    const bumped = manifests.map((file) => ({ file, ...bumpCatalog(before.get(file)!, version, relative(root, file)) }));
    if (bumped[0].names.length === 0) {
        throw new Error('The catalog in package.json holds no ADE CORE package.');
    }
    // The image installs from its own manifest, so it has to end on the same catalog as the root.
    const drift = bumped.slice(1).filter((entry) => !Bun.deepEquals(catalogOf(JSON.parse(entry.text)), catalogOf(JSON.parse(bumped[0].text))));
    if (drift.length > 0) {
        throw new Error(`${relative(root, drift[0].file)} does not list the same ADE CORE packages as the root catalog. No file was changed.`);
    }
    // Before any write: a release still propagating would otherwise leave a half-installed node_modules.
    await awaitRelease(bumped[0].names, version, registry);
    for (const entry of bumped) {
        if (entry.text !== before.get(entry.file)) {
            writeFileSync(entry.file, entry.text);
        }
    }
    try {
        await run(root, ['install']);
    } catch (error) {
        for (const [file, text] of before) {
            writeFileSync(file, text);
        }
        throw error;
    }
    const missed = lockedOffVersion(readFileSync(lockfile, 'utf8'), version).map((entry) => `bun.lock: ${entry}`);
    if (missed.length > 0) {
        throw new Error(`These ADE CORE entries are not on ${version}. Review the catalog and bun.lock:\n  ${missed.join('\n  ')}`);
    }
    if (statusMode(packageStatus(root, adecore)) !== 'npm') {
        throw new Error(`Some ADE CORE packages do not resolve to the npm install of ${version}. Run adecore:status to inspect them.`);
    }
    clearClientCache(root);
}

function installedVersion(folder: string, name: string): string | null {
    for (;;) {
        const path = join(folder, 'node_modules', name);
        if (existsSync(join(path, 'package.json'))) {
            const manifest = readPackage(path).manifest;
            return manifest.name === name ? (manifest.version ?? null) : null;
        }
        const parent = dirname(folder);
        if (parent === folder) {
            return null;
        }
        folder = parent;
    }
}

export function peerVersionDrift(root: string, adecore: string): string[] {
    const warnings = new Map<string, string>();
    const adecoreFolder = resolvedFolder(adecore) ?? resolve(adecore);
    for (const consumer of packageStatus(root, adecore).filter((pkg) => pkg.mode === 'local')) {
        const pending = [consumer.target!];
        const visited = new Set<string>();
        for (const folder of pending) {
            if (visited.has(folder)) {
                continue;
            }
            visited.add(folder);
            const pkg = readPackage(folder);
            const dependencies = dependenciesOf(pkg.manifest, true);
            const peers = new Set([
                ...Object.keys(pkg.manifest.peerDependencies ?? {}),
                ...['zod', 'zustand'].filter((name) => pkg.manifest.dependencies?.[name])
            ]);
            for (const name of peers) {
                if (name.startsWith('@adecore/')) {
                    continue;
                }
                const local = installedVersion(folder, name);
                const installed = installedVersion(join(root, consumer.workspace), name);
                if (local && installed && local !== installed) {
                    const key = `${consumer.workspace}:${name}:${installed}:${local}`;
                    const scope = name === 'electron' ? ' (types; runtime is external)' : '';
                    warnings.set(
                        key,
                        `${consumer.workspace}: ${name} is ${installed} in Ruimte and ${local} in ADE CORE via ${pkg.manifest.name}${scope}. Align versions if this affects the consumer.`
                    );
                }
            }
            for (const name of Object.keys(dependencies).filter((name) => name.startsWith('@adecore/'))) {
                const target = resolvedFolder(join(folder, 'node_modules', name));
                if (target && isInside(adecoreFolder, target)) {
                    pending.push(target);
                }
            }
        }
    }
    return [...warnings.values()];
}

function printStatus(root: string, adecore: string, brief = false): 'npm' | 'local' | 'mixed' {
    const packages = packageStatus(root, adecore);
    const mode = statusMode(packages);
    if (brief) {
        console.log(`ADE CORE: ${mode} (${packages.length} consumers${mode === 'npm' ? '' : `; ${adecore}`})`);
        return mode;
    }
    console.log(`ADE CORE: ${mode}`);
    if (mode !== 'npm') {
        console.log(`Local folder: ${adecore}`);
    }
    for (const pkg of packages) {
        const source = pkg.mode === 'npm' ? `npm ${pkg.version}` : `${pkg.mode} ${pkg.target ?? '(not installed)'}`;
        console.log(`  ${pkg.workspace}: ${pkg.name} -> ${source}`);
    }
    for (const warning of peerVersionDrift(root, adecore)) {
        console.warn(`Version advice: ${warning}`);
    }
    return mode;
}

async function main(): Promise<void> {
    const [command, ...args] = process.argv.slice(2);
    const bump = command === 'bump' && args.length === 1 && !args[0].startsWith('-');
    if (
        !bump &&
        (!['link', 'npm', 'status', 'check'].includes(command ?? '') ||
            args.some((arg) => !['--npm', '--brief'].includes(arg)) ||
            (args.length > 0 && command !== 'status'))
    ) {
        throw new Error('Usage: bun run adecore:link | adecore:npm | adecore:status [--npm] [--brief] | adecore:check | adecore:bump <version>');
    }
    const root = resolve(import.meta.dir, '..');
    const adecore = adecorePath(root);
    if (command === 'check') {
        const problems = [...catalogProblems(root), ...dockerCatalogDrift(root)];
        if (problems.length > 0) {
            console.error(`ADE CORE versions come only from the catalog in package.json:\n  ${problems.join('\n  ')}`);
            process.exitCode = 1;
        }
        return;
    }
    if (command === 'link') {
        linkLocalPackages(root, adecore);
    } else if (command === 'npm') {
        await restoreNpmPackages(root, adecore);
    } else if (bump) {
        await bumpPackages(root, adecore, args[0]);
    }
    const mode = printStatus(root, adecore, args.includes('--brief'));
    if (mode === 'mixed' || ((bump || args.includes('--npm')) && mode !== 'npm')) {
        process.exitCode = 1;
    }
    if (bump) {
        console.log(`The ADE CORE catalog is ${args[0]}. Commit package.json, ${DOCKER_MANIFEST} and bun.lock together.`);
    } else if (command !== 'status') {
        console.log('Restart bun dev after switching. Package manifests and bun.lock are unchanged.');
    }
}

if (import.meta.main) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
