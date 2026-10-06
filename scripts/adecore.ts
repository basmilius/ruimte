import { Glob } from 'bun';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

interface Manifest {
    name: string;
    version?: string;
    workspaces?: string[] | { packages: string[] };
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

function consumersIn(root: string): Dependency[] {
    return packagesIn(root).flatMap((consumer) =>
        Object.entries(dependenciesOf(consumer.manifest))
            .filter(([name]) => name.startsWith('@adecore/'))
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, version]) => ({ consumer, name, version, path: join(consumer.folder, 'node_modules', name) }))
    );
}

function isInside(root: string, path: string): boolean {
    const child = relative(root, path);
    return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
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
        const installed = target !== null && isInside(root, target) && relative(root, target).split(sep).includes('node_modules');
        const manifest = installed ? readPackage(target!).manifest : null;
        const exactVersion = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(dep.version);
        const npm = manifest?.name === dep.name && (!exactVersion || manifest.version === dep.version);
        const mode = target === null ? 'missing' : isInside(local, target) ? 'local' : npm ? 'npm' : 'other';
        return { workspace: relative(root, dep.consumer.folder) || '.', name: dep.name, version: dep.version, target, mode };
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
        for (const dep of plan.consumers) {
            const pkg = plan.packages.find((entry) => entry.manifest.name === dep.name)!;
            link(dep.path, pkg.folder);
        }
        unchanged();
        sourceUnchanged();
        for (const dep of plan.consumers) {
            const expected = plan.packages.find((pkg) => pkg.manifest.name === dep.name)!;
            if (resolvedFolder(dep.path) !== realpathSync(expected.folder)) {
                throw new Error(`${dep.path} does not resolve to ${expected.folder}.`);
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
                if (target && isInside(resolvedFolder(adecore) ?? resolve(adecore), target)) {
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
    if (
        !['link', 'npm', 'status'].includes(command ?? '') ||
        args.some((arg) => !['--npm', '--brief'].includes(arg)) ||
        (args.length > 0 && command !== 'status')
    ) {
        throw new Error('Usage: bun run adecore:link | adecore:npm | adecore:status [--npm] [--brief]');
    }
    const root = resolve(import.meta.dir, '..');
    const adecore = adecorePath(root);
    if (command === 'link') {
        linkLocalPackages(root, adecore);
    } else if (command === 'npm') {
        await restoreNpmPackages(root, adecore);
    }
    const mode = printStatus(root, adecore, args.includes('--brief'));
    if (mode === 'mixed' || (args.includes('--npm') && mode !== 'npm')) {
        process.exitCode = 1;
    }
    if (command !== 'status') {
        console.log('Restart bun dev after switching. Package manifests and bun.lock are unchanged.');
    }
}

if (import.meta.main) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
