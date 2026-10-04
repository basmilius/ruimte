import { dirname, join } from 'node:path';
import { packageNameOf, TARGETS } from './targets';

/*
 * What the `ruimte` launcher decides before it runs anything: which platform package holds the
 * binary for this machine, and where npm put it. Pure over the platform and a resolver, so every
 * refusal is a test rather than something found out on a machine that has no Windows build.
 */

export interface Host {
    platform: string;
    arch: string;
}

/* `require.resolve` in the launcher; throws when the package is not installed. */
export type Resolve = (request: string) => string;

/* The C library a Linux machine runs on; null where that is not the question. */
export type Libc = 'glibc' | 'musl' | null;

export class LauncherError extends Error {}

export const WINDOWS_REFUSAL = 'Ruimte does not run on Windows yet. It runs on Macs with Apple silicon and on Linux, on arm64 and x64.';

export const INTEL_NODE_REFUSAL =
    'This Node is built for Intel Macs, and Ruimte runs on Macs with Apple silicon only. On a Mac with Apple silicon this Node runs under Rosetta: install the arm64 build of Node and run Ruimte with that.';

export const MUSL_REFUSAL =
    'Ruimte runs on Linux with glibc, and this system uses musl (as Alpine does), so npm left its binary out. Run it on a distribution with glibc, such as Debian or Ubuntu, or in a container of one.';

export function platformPackageOf(host: Host): string {
    if (host.platform === 'win32') {
        throw new LauncherError(WINDOWS_REFUSAL);
    }
    if (host.platform === 'darwin' && host.arch === 'x64') {
        throw new LauncherError(INTEL_NODE_REFUSAL);
    }
    const target = TARGETS.find((candidate) => candidate.os === host.platform && candidate.cpu === host.arch);
    if (!target) {
        throw new LauncherError(`Ruimte has no build for ${host.platform} on ${host.arch}. It runs on Macs with Apple silicon and on Linux, on arm64 and x64.`);
    }
    return packageNameOf(target);
}

/* `libc` is asked only once the package turns out missing, since finding it out costs a process report. */
export function binaryPathOf(host: Host, resolve: Resolve, libc: () => Libc = () => null): string {
    const name = platformPackageOf(host);
    let manifest: string;
    try {
        manifest = resolve(`${name}/package.json`);
    } catch {
        if (host.platform === 'linux' && libc() === 'musl') {
            throw new LauncherError(MUSL_REFUSAL);
        }
        throw new LauncherError(
            `The package ${name} is missing. It holds the Ruimte binary for this machine and npm installs it as an optional dependency, ` +
                'so an install with --omit=optional or --no-optional leaves it out. Install ruimte again without that flag.'
        );
    }
    return join(dirname(manifest), 'bin', 'ruimte');
}

/* The launcher's exit code for a binary that ended: its own code, or 128 plus the signal as a shell reports it. */
export function exitCodeOf(code: number | null, signalNumber: number | null): number {
    if (code !== null) {
        return code;
    }
    return signalNumber === null ? 1 : 128 + signalNumber;
}
