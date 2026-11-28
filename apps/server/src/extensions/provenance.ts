import { existsSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { ExtensionProvenance } from '@ruimte/contracts';

/*
 * The folders of Ruimte's repository that hold its development extensions, from its root. The dev launch links what is
 * in them (`scripts/dev-extensions.ts`) and no build may carry any of it (`scripts/check-build-outputs.ts`).
 */
export const DEVELOPMENT_EXTENSION_FOLDERS = ['extensions/dev', 'extensions/poc'] as const;

/*
 * Extensions of this repository that are products of their own and use a proposed part, so they cannot be installed
 * yet. The dev launch links each as its author would, which makes it a dev link and no development extension, and no
 * build may carry one either.
 */
export const LINKED_EXTENSION_FOLDERS = ['extensions/devcontainers'] as const;

/*
 * Those folders on this computer, for a daemon that runs from a checkout. A compiled daemon has no checkout, so to it
 * no extension is a development extension, whatever folder a person links.
 */
export function developmentExtensionRoots(compiled: boolean, sourceDir: string): string[] {
    if (compiled) {
        return [];
    }

    const repository = join(sourceDir, '..', '..', '..');

    return (
        DEVELOPMENT_EXTENSION_FOLDERS.map((folder) => join(repository, folder))
            .filter((folder) => existsSync(folder))
            // Real, as the folder a build links is.
            .map((folder) => realpathSync(folder))
    );
}

/*
 * Where an extension on this machine came from, decided on what the machine itself holds and never on its manifest.
 * The one place that answers it, so a rule that depends on it asks here.
 */
export function extensionProvenance(extension: { devFolder?: string | undefined }, developmentRoots: readonly string[]): ExtensionProvenance {
    const { devFolder } = extension;

    if (devFolder === undefined) {
        return 'installed';
    }

    return developmentRoots.some((root) => devFolder.startsWith(`${root}${sep}`)) ? 'development' : 'dev-link';
}
