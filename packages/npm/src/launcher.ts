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

export class LauncherError extends Error {}

export const WINDOWS_REFUSAL = 'Ruimte does not run on Windows yet. It runs on macOS and Linux, on arm64 and x64.';

export const platformPackageOf = (host: Host): string => {
    if (host.platform === 'win32') {
        throw new LauncherError(WINDOWS_REFUSAL);
    }
    const target = TARGETS.find((candidate) => candidate.os === host.platform && candidate.cpu === host.arch);
    if (!target) {
        throw new LauncherError(`Ruimte has no build for ${host.platform} on ${host.arch}. It runs on macOS and Linux, on arm64 and x64.`);
    }
    return packageNameOf(target);
};

export const binaryPathOf = (host: Host, resolve: Resolve): string => {
    const name = platformPackageOf(host);
    let manifest: string;
    try {
        manifest = resolve(`${name}/package.json`);
    } catch {
        throw new LauncherError(
            `The package ${name} is missing. It holds the Ruimte binary for this machine and npm installs it as an optional dependency, ` +
                'so an install with --omit=optional or --no-optional leaves it out. Install ruimte again without that flag.'
        );
    }
    return join(dirname(manifest), 'bin', 'ruimte');
};

/* The launcher's exit code for a binary that ended: its own code, or 128 plus the signal as a shell reports it. */
export const exitCodeOf = (code: number | null, signalNumber: number | null): number => {
    if (code !== null) {
        return code;
    }
    return signalNumber === null ? 1 : 128 + signalNumber;
};
