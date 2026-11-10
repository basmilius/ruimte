import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * A module is a workspace plus the first folder under its `src` (or the file, for a file directly in it). The
 * untangle branch took the cycles between modules to zero, type-only imports included, and this keeps them there.
 */
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SKIPPED = /\.test\.tsx?$|\.d\.ts$|\/testing\/|test-helpers|\.stories\./;
const IMPORT = /^[ \t]*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|^[ \t]*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

export interface Workspace {
    readonly directory: string;
    readonly name: string;

    /** The TypeScript file each subpath of `exports` points at (`./prompts`, `./locales/*`), relative to the workspace. */
    readonly exports?: Readonly<Record<string, string>>;
}

export interface ImportSite {
    readonly file: string;
    readonly line: number;
    readonly specifier: string;
}

export interface Hop {
    readonly from: string;
    readonly to: string;
    readonly site: ImportSite;
}

export interface ModuleCycle {
    readonly modules: string[];
    readonly hops: Hop[];
}

export function isCheckedSource(path: string): boolean {
    return /\.tsx?$/.test(path) && !SKIPPED.test(path);
}

export function workspaceFrom(manifestPath: string, text: string): Workspace | undefined {
    const manifest: { name?: unknown; exports?: unknown } = JSON.parse(text);

    if (typeof manifest.name !== 'string') {
        return undefined;
    }

    const directory = posix.dirname(manifestPath) === '.' ? '' : posix.dirname(manifestPath);
    const entries = typeof manifest.exports === 'object' && manifest.exports !== null ? Object.entries(manifest.exports) : [];
    const subpaths = entries.length > 0 && entries.every(([key]) => key.startsWith('.')) ? entries : [['.', manifest.exports] as const];
    const exports: Record<string, string> = {};

    for (const [subpath, target] of subpaths) {
        const source = sourceTarget(target);

        if (source !== undefined) {
            exports[subpath] = source;
        }
    }

    return { directory, name: manifest.name, exports };
}

/* The first condition that points at TypeScript, such as `source`; a `types` target is a declaration and never matches. */
function sourceTarget(target: unknown): string | undefined {
    if (typeof target === 'string') {
        return /\.tsx?$/.test(target) && !target.endsWith('.d.ts') ? target : undefined;
    }

    if (typeof target !== 'object' || target === null) {
        return undefined;
    }

    for (const condition of Object.values(target)) {
        const found = sourceTarget(condition);

        if (found !== undefined) {
            return found;
        }
    }

    return undefined;
}

function exportedSource(workspace: Workspace, subpath: string): string | undefined {
    const exact = workspace.exports?.[subpath];

    if (exact !== undefined) {
        return exact;
    }

    for (const [pattern, target] of Object.entries(workspace.exports ?? {})) {
        const [prefix, suffix] = pattern.split('*');

        if (suffix !== undefined && subpath.length >= prefix.length + suffix.length && subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
            return target.replace('*', subpath.slice(prefix.length, subpath.length - suffix.length));
        }
    }

    return undefined;
}

/* The first import site per pair of modules, keyed by the importing module and then the imported one. */
export function moduleEdges(sources: ReadonlyMap<string, string>, workspaces: readonly Workspace[]): Map<string, Map<string, ImportSite>> {
    const byDepth = [...workspaces].sort((left, right) => right.directory.length - left.directory.length);
    const edges = new Map<string, Map<string, ImportSite>>();

    const workspaceOf = (file: string): Workspace | undefined =>
        byDepth.find((workspace) => workspace.directory === '' || file.startsWith(`${workspace.directory}/`));

    const moduleOf = (file: string): string => {
        const directory = workspaceOf(file)?.directory ?? '';
        const parts = (directory === '' ? file : file.slice(directory.length + 1)).split('/');
        const inSrc = parts[0] === 'src' && parts.length > 1;
        const head = inSrc ? parts.slice(0, 2) : parts.slice(0, 1);
        const last = head.length - 1;

        if (parts.length === head.length) {
            head[last] = head[last].replace(/\.tsx?$/, '');
        }

        return [directory, ...head].filter((part) => part !== '').join('/');
    };

    const resolveFile = (base: string): string | undefined => {
        const normalized = posix.normalize(base);

        for (const candidate of [normalized, `${normalized}.ts`, `${normalized}.tsx`, `${normalized}/index.ts`, `${normalized}/index.tsx`]) {
            if (sources.has(candidate)) {
                return candidate;
            }
        }

        return normalized.endsWith('.js') ? resolveFile(normalized.slice(0, -3)) : undefined;
    };

    const resolveImport = (file: string, specifier: string): string | undefined => {
        if (specifier.startsWith('.')) {
            return resolveFile(posix.join(posix.dirname(file), specifier));
        }

        // A built-in extension's `@/` and the client's `@extensions/` are left out: the client reaches its built-ins
        // through one door (`extensions/built-in.ts`) and they read the client back, by design.
        if (specifier.startsWith('@/')) {
            return resolveFile(posix.join(workspaceOf(file)?.directory ?? '', 'src', specifier.slice(2)));
        }

        const workspace = workspaces.find((entry) => specifier === entry.name || specifier.startsWith(`${entry.name}/`));

        if (!workspace) {
            return undefined;
        }

        const rest = specifier.slice(workspace.name.length + 1);
        const exported = exportedSource(workspace, rest === '' ? '.' : `./${rest}`);
        const fallback = resolveFile(posix.join(workspace.directory, 'src', rest || 'index'));

        return exported === undefined ? fallback : (resolveFile(posix.join(workspace.directory, exported)) ?? fallback);
    };

    for (const [file, text] of sources) {
        if (!isCheckedSource(file)) {
            continue;
        }

        const from = moduleOf(file);

        for (const match of text.matchAll(IMPORT)) {
            const specifier = match[1] ?? match[2] ?? match[3];
            const target = resolveImport(file, specifier);

            if (target === undefined) {
                continue;
            }

            const to = moduleOf(target);
            const row = edges.get(from) ?? new Map<string, ImportSite>();

            if (to === from || row.has(to)) {
                continue;
            }

            row.set(to, { file, line: text.slice(0, match.index).split('\n').length, specifier });
            edges.set(from, row);
        }
    }

    return edges;
}

/* Every strongly connected group of modules, with the shortest way around it through its first module. */
export function moduleCycles(edges: ReadonlyMap<string, ReadonlyMap<string, ImportSite>>): ModuleCycle[] {
    const order = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const groups: string[][] = [];

    const visit = (node: string): void => {
        const index = order.size;

        order.set(node, index);
        low.set(node, index);
        stack.push(node);
        onStack.add(node);

        for (const next of edges.get(node)?.keys() ?? []) {
            if (!order.has(next)) {
                visit(next);
                low.set(node, Math.min(low.get(node) ?? index, low.get(next) ?? index));
            } else if (onStack.has(next)) {
                low.set(node, Math.min(low.get(node) ?? index, order.get(next) ?? index));
            }
        }

        if (low.get(node) !== index) {
            return;
        }

        const group: string[] = [];
        let member: string | undefined;

        do {
            member = stack.pop();

            if (member !== undefined) {
                onStack.delete(member);
                group.push(member);
            }
        } while (member !== undefined && member !== node);

        if (group.length > 1) {
            groups.push(group.sort());
        }
    };

    for (const node of [...edges.keys()].sort()) {
        if (!order.has(node)) {
            visit(node);
        }
    }

    return groups.sort((left, right) => left[0].localeCompare(right[0])).map((modules) => ({ modules, hops: shortestLoop(edges, modules) }));
}

function shortestLoop(edges: ReadonlyMap<string, ReadonlyMap<string, ImportSite>>, modules: readonly string[]): Hop[] {
    const start = modules[0];
    const members = new Set(modules);
    const cameFrom = new Map<string, string>();
    const queue = [start];

    for (let i = 0; i < queue.length; i++) {
        const node = queue[i];

        for (const next of edges.get(node)?.keys() ?? []) {
            if (!members.has(next) || cameFrom.has(next)) {
                continue;
            }

            cameFrom.set(next, node);

            if (next === start) {
                queue.length = i + 1;
                break;
            }

            queue.push(next);
        }
    }

    const path = [start];

    for (let node = cameFrom.get(start); node !== undefined && node !== start; node = cameFrom.get(node)) {
        path.unshift(node);
    }

    path.unshift(start);

    return path.slice(1).map((to, i) => {
        const from = path[i];
        const site = edges.get(from)?.get(to);

        if (site === undefined) {
            throw new Error(`No import from ${from} to ${to}`);
        }

        return { from, to, site };
    });
}

export function describeCycles(cycles: readonly ModuleCycle[]): string {
    const blocks = cycles.map((cycle) => {
        const hops = cycle.hops.map(({ from, to, site }) => `    ${from} -> ${to}\n      ${site.file}:${site.line} imports '${site.specifier}'`);

        return [`  ${cycle.modules.length} modules: ${cycle.modules.join(', ')}`, '  One way around, cut any of these imports:', ...hops].join('\n');
    });

    return [`${cycles.length} module ${cycles.length === 1 ? 'cycle' : 'cycles'}:`, ...blocks].join('\n\n');
}

function trackedFiles(): string[] {
    const listed = Bun.spawnSync(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.ts', '*.tsx', '*package.json'], {
        cwd: ROOT
    });

    if (listed.exitCode !== 0) {
        throw new Error(`git ls-files failed: ${listed.stderr.toString()}`);
    }

    return [...new Set(listed.stdout.toString().split('\0'))].filter((path) => path !== '');
}

if (import.meta.main) {
    const sources = new Map<string, string>();
    const workspaces: Workspace[] = [];

    for (const path of trackedFiles()) {
        let text: string;

        try {
            text = readFileSync(join(ROOT, path), 'utf8');
        } catch {
            // Deleted in the working tree but still in the index.
            continue;
        }

        if (posix.basename(path) !== 'package.json') {
            sources.set(path, text);
            continue;
        }

        const workspace = workspaceFrom(path, text);

        if (workspace !== undefined) {
            workspaces.push(workspace);
        }
    }

    const cycles = moduleCycles(moduleEdges(sources, workspaces));

    if (cycles.length > 0) {
        console.error(describeCycles(cycles));
        console.error('\nA module is a workspace plus the first folder under its src; type-only imports count.');
        process.exitCode = 1;
    }
}
