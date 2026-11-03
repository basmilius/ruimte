import { LAUNCHER_NAME } from './targets';

/*
 * The order and the skips of a publish. The platform packages go first and the launcher last, so
 * no moment exists where `ruimte` on npm names a binary that is not there yet; a version already on
 * the registry is skipped, so a workflow that failed halfway can run again.
 */

export interface PackageToPublish {
    name: string;
    dir: string;
}

export interface PublishStep extends PackageToPublish {
    action: 'publish' | 'skip';
    /* Always named: npm moves `latest` to whatever is published without one. */
    tag: string;
}

export interface RegistryLookup {
    /* Whether `name@version` is on the registry; throws when it cannot tell. */
    published(name: string, version: string): Promise<boolean>;
    /* The version `latest` points at, null for a package that is not on the registry yet; throws when it cannot tell. */
    latest(name: string): Promise<string | null>;
}

/*
 * `latest` never points at a prerelease, and never moves back: a run of 0.11.0 that finishes after
 * the one of 0.11.1, or runs again, publishes under a tag of its own.
 */
export function distTagOf(version: string, latest: string | null): string {
    if (version.includes('-')) {
        return 'next';
    }
    return latest === null || Bun.semver.order(version, latest) >= 0 ? 'latest' : 'previous';
}

export async function planPublish(packages: PackageToPublish[], version: string, registry: RegistryLookup): Promise<PublishStep[]> {
    const steps: PublishStep[] = [];
    const ordered = [...packages.filter((entry) => entry.name !== LAUNCHER_NAME), ...packages.filter((entry) => entry.name === LAUNCHER_NAME)];

    for (const entry of ordered) {
        if (await registry.published(entry.name, version)) {
            steps.push({ ...entry, action: 'skip', tag: distTagOf(version, null) });
            continue;
        }
        steps.push({ ...entry, action: 'publish', tag: distTagOf(version, await registry.latest(entry.name)) });
    }
    return steps;
}

/*
 * A failed `npm publish` may have landed after all: npm retries an upload that took too long and
 * trips over its own first attempt (a 409 from the transparency log), and a rerun the registry's lag
 * kept from skipping a version gets E403. The registry shows a new version only after a while, so it
 * is asked a few times before the failure counts.
 */
export async function landedAfterAll(registry: RegistryLookup, name: string, version: string, wait: () => Promise<void>, attempts = 6): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
        await wait();

        if (await registry.published(name, version).catch(() => false)) {
            return true;
        }
    }

    return false;
}

export interface CommandOutcome {
    code: number;
    stdout: string;
    stderr: string;
}

/* `npm view` fails with E404 for a package that is not on the registry at all, which answers null. */
function viewOutput(outcome: CommandOutcome): string | null {
    if (outcome.code === 0) {
        return outcome.stdout.trim().replace(/^"|"$/g, '');
    }

    if (outcome.stderr.includes('E404')) {
        return null;
    }

    throw new Error(`npm view failed (${outcome.code}): ${outcome.stderr.trim() || outcome.stdout.trim() || 'no output'}`);
}

/* `npm view <name> dist-tags.latest`. */
export function latestFromView(outcome: CommandOutcome): string | null {
    return viewOutput(outcome) || null;
}

/* `npm view <name>@<version> version` prints nothing when the package exists without that version. */
export function publishedFromView(version: string, outcome: CommandOutcome): boolean {
    return viewOutput(outcome) === version;
}
