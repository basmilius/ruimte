import { LAUNCHER_NAME, packageNameOf, TARGETS, type Target } from './targets';

/*
 * The package.json of every package that goes to npm, written at publish time with the version of
 * the release. The launcher pins every platform package to that exact version, so an install never
 * mixes a launcher with a binary from another release.
 */

export type Manifest = Record<string, unknown>;

/* npm checks `repository` against the workflow that publishes with provenance, so it names this repository exactly. */
const COMMON = {
    license: 'FSL-1.1-MIT',
    author: 'Bas Milius',
    homepage: 'https://ruimte.app',
    repository: { type: 'git', url: 'git+https://github.com/basmilius/ruimte.git', directory: 'packages/npm' }
};

const OS_NAMES: Record<Target['os'], string> = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };

export function platformManifest(target: Target, version: string): Manifest {
    return {
        name: packageNameOf(target),
        version,
        description: `The Ruimte machine for ${OS_NAMES[target.os]} on ${target.cpu}. Install ruimte instead; it picks this package for you.`,
        ...COMMON,
        os: [target.os],
        cpu: [target.cpu],
        // Bun's Linux binaries link against glibc; npm leaves the package out on musl rather than install one that does not start.
        ...(target.os === 'linux' ? { libc: ['glibc'] } : {}),
        files: ['bin']
    };
}

export const EXTENSION_DIR = 'extension';

const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/* The default catalog of the root `package.json`, which a published package cannot read. */
export function catalogOf(root: Manifest): Record<string, string> {
    const workspaces = root.workspaces as string[] | { catalog?: Record<string, string> } | undefined;

    return Array.isArray(workspaces) ? {} : (workspaces?.catalog ?? {});
}

/* `npm publish` does not know the `catalog:` protocol, so each reference becomes the version the catalog holds. */
export function resolveCatalog(source: Manifest, catalog: Record<string, string>): Manifest {
    const resolved: Manifest = { ...source };

    for (const section of DEPENDENCY_SECTIONS) {
        const dependencies = source[section] as Record<string, string> | undefined;

        if (!dependencies) {
            continue;
        }

        resolved[section] = Object.fromEntries(
            Object.entries(dependencies).map(([name, range]) => {
                if (!range.startsWith('catalog:')) {
                    return [name, range];
                }

                const version = range === 'catalog:' ? catalog[name] : undefined;

                if (version === undefined) {
                    throw new Error(`${name} in ${section} is "${range}", which the default catalog of the root package.json cannot resolve.`);
                }

                return [name, version];
            })
        );
    }

    return resolved;
}

/* Its own `package.json` at this version, under its own license: the types are MIT, the app is not. */
export function extensionManifest(source: Manifest, version: string, catalog: Record<string, string>): Manifest {
    return {
        ...resolveCatalog(source, catalog),
        version,
        author: COMMON.author,
        homepage: COMMON.homepage,
        repository: { ...COMMON.repository, directory: 'packages/extension' }
    };
}

/* `targets` is what this release ships; a platform left out of it is left out of the install as well. */
export function launcherManifest(version: string, targets: readonly Target[] = TARGETS): Manifest {
    return {
        name: LAUNCHER_NAME,
        version,
        description:
            'Ruimte for a machine without the app: the machine that terminals, agents and browsers run on, reachable from the Ruimte app and station.ruimte.app.',
        ...COMMON,
        type: 'module',
        bin: { ruimte: 'bin/ruimte.js' },
        files: ['bin'],
        engines: { node: '>=18' },
        optionalDependencies: Object.fromEntries(targets.map((target) => [packageNameOf(target), version]))
    };
}
