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

const OS_NAMES: Record<Target['os'], string> = { darwin: 'macOS', linux: 'Linux' };

export const platformManifest = (target: Target, version: string): Manifest => ({
    name: packageNameOf(target),
    version,
    description: `The Ruimte machine for ${OS_NAMES[target.os]} on ${target.cpu}. Install ruimte instead; it picks this package for you.`,
    ...COMMON,
    os: [target.os],
    cpu: [target.cpu],
    // The Linux build links against glibc; npm leaves it out on musl rather than install one that does not start.
    ...(target.os === 'linux' ? { libc: ['glibc'] } : {}),
    files: ['bin']
});

export const launcherManifest = (version: string): Manifest => ({
    name: LAUNCHER_NAME,
    version,
    description:
        'Ruimte for a machine without the app: the machine that terminals, agents and browsers run on, reachable from the Ruimte app and station.ruimte.app.',
    ...COMMON,
    type: 'module',
    bin: { ruimte: 'bin/ruimte.js' },
    files: ['bin'],
    engines: { node: '>=18' },
    optionalDependencies: Object.fromEntries(TARGETS.map((target) => [packageNameOf(target), version]))
});
