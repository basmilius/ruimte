/*
 * The platforms the `ruimte` package ships a binary for, one `@ruimte/<os>-<cpu>` package each. The
 * names are Node's `process.platform` and `process.arch`, which are also what npm's `os` and `cpu` read.
 */
export interface Target {
    os: 'darwin' | 'linux';
    cpu: 'arm64' | 'x64';
}

export const TARGETS: readonly Target[] = [
    { os: 'darwin', cpu: 'arm64' },
    { os: 'darwin', cpu: 'x64' },
    { os: 'linux', cpu: 'x64' },
    { os: 'linux', cpu: 'arm64' }
];

export const LAUNCHER_NAME = 'ruimte';

/* `darwin-arm64`: the folder a build lands in and the second half of the package name. */
export const targetId = (target: Target): string => `${target.os}-${target.cpu}`;

export const packageNameOf = (target: Target): string => `@ruimte/${targetId(target)}`;
