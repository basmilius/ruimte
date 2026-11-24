/*
 * What an extension supplies to Ruimte, and which of it is still proposed. One table, read where a manifest comes in
 * (`ruimte extension pack`, an install, a dev link), by the hosts and by the test hosts, so none of them decides it
 * apart. Pure, with no import that needs zod, so the runtime of an extension's process carries it too.
 */

/* One provider point: a kind of thing an extension supplies, listed by id under `provides` in its manifest. */
export interface ExtensionProviderPoint {
    /* The function of `@ruimte/extension/server` that registers one. */
    readonly define: string;
    /* The permission a manifest that provides one asks for. */
    readonly permission: string;

    /*
     * Still proposed: the manifest names the kind under `proposed`, it works only where `allowsProposed` says so, and
     * its shape may change in any release. A point that leaves this tier drops the flag.
     */
    readonly proposed: boolean;
}

/*
 * Every provider point, by the key `provides` lists it under, which is also the name `proposed` takes. A new point is
 * one row here, with its permission in `EXTENSION_PERMISSIONS`.
 */
export const EXTENSION_PROVIDER_POINTS: Readonly<Record<string, ExtensionProviderPoint>> = {
    terminalProfiles: { define: 'defineTerminalProfile', permission: 'terminals.profiles', proposed: true },
    launchSources: { define: 'defineLaunchSource', permission: 'launches.provide', proposed: true },
    problemSources: { define: 'defineProblemSource', permission: 'problems.provide', proposed: true },
    machineSources: { define: 'defineMachineSource', permission: 'machines.provide', proposed: true },
    notificationChannels: { define: 'defineNotificationChannel', permission: 'notifications.provide', proposed: true }
};

// The most launches one launch source lists in a project; the rest is cut, so a source cannot fill the menu.
export const MAX_SOURCED_LAUNCHES = 64;

// The most places one machine source lists in a project, and the most programs one start runs.
export const MAX_MACHINE_CANDIDATES = 16;
export const MAX_MACHINE_STEPS = 16;

/* The id a launch of a source goes by among a project's launches, which says the extension and the source it has to come from. */
export function sourcedLaunchId(extension: string, source: string, launch: string): string {
    return `${extension}:${source}:${launch}`;
}

/* The names a manifest may list under `proposed`. */
export const EXTENSION_PROPOSED_PARTS: readonly string[] = Object.keys(EXTENSION_PROVIDER_POINTS).filter(
    (kind) => EXTENSION_PROVIDER_POINTS[kind]?.proposed === true
);

interface ProvidingManifest {
    readonly id?: string | undefined;
    readonly permissions?: Readonly<Record<string, string>> | undefined;
    readonly provides?: Readonly<Record<string, readonly string[]>> | undefined;
    readonly proposed?: readonly string[] | undefined;
}

function pointOf(kind: string): ExtensionProviderPoint | null {
    return Object.hasOwn(EXTENSION_PROVIDER_POINTS, kind) ? (EXTENSION_PROVIDER_POINTS[kind] ?? null) : null;
}

/* The provider point a function of `@ruimte/extension/server` registers for, with its kind, or null for any other call. */
export function providerPointOf(define: string): { kind: string; point: ExtensionProviderPoint } | null {
    const kind = Object.keys(EXTENSION_PROVIDER_POINTS).find((each) => EXTENSION_PROVIDER_POINTS[each]?.define === define);
    const point = kind === undefined ? null : pointOf(kind);

    return kind === undefined || point === null ? null : { kind, point };
}

/* What a manifest lists under `provides` and `proposed` that does not hold together, one line each. */
export function extensionProvidesProblems(manifest: ProvidingManifest): string[] {
    const proposed = manifest.proposed ?? [];
    const problems = proposed
        .filter((name) => !EXTENSION_PROPOSED_PARTS.includes(name))
        .map((name) => `${name} is not a proposed part this Ruimte knows (${EXTENSION_PROPOSED_PARTS.join(', ')})`);

    for (const kind of Object.keys(manifest.provides ?? {})) {
        const point = pointOf(kind);

        if (point === null) {
            problems.push(`provides.${kind} is not something this Ruimte takes from an extension (${Object.keys(EXTENSION_PROVIDER_POINTS).join(', ')})`);

            continue;
        }

        if (!Object.hasOwn(manifest.permissions ?? {}, point.permission)) {
            problems.push(`provides.${kind} needs the permission ${point.permission}`);
        }

        if (point.proposed && !proposed.includes(kind)) {
            problems.push(`provides.${kind} is still proposed; name ${kind} under proposed`);
        }
    }

    return problems;
}

/* The proposed parts a manifest names or uses. */
export function proposedPartsOf(manifest: ProvidingManifest): string[] {
    const provided = Object.keys(manifest.provides ?? {}).filter((kind) => pointOf(kind)?.proposed === true);

    return [...new Set([...(manifest.proposed ?? []), ...provided])];
}

/*
 * Whether a proposed part works for an extension that came this way: under a dev link, as a development extension of
 * Ruimte's own repository, and as a built-in. Never for one a person installed, and never on a provenance nobody told.
 */
export function allowsProposed(provenance: string | undefined): boolean {
    return provenance === 'dev-link' || provenance === 'development' || provenance === 'built-in';
}

/* Why an extension that came this way does not run, in words a person reads in Settings; null when it may. */
export function proposedRefusal(manifest: ProvidingManifest, provenance: string | undefined): string | null {
    const parts = proposedPartsOf(manifest);

    if (parts.length === 0 || allowsProposed(provenance)) {
        return null;
    }

    return `This extension uses a part of Ruimte that is not final yet (${parts.join(', ')}). It works while its author develops it, and an installed extension cannot use it.`;
}

/* What `ruimte extension pack` and `publish` say of a pack a store install will refuse; null for one it takes. */
export function proposedPackWarning(manifest: ProvidingManifest): string | null {
    const parts = proposedPartsOf(manifest);

    return parts.length === 0
        ? null
        : `${manifest.id ?? 'This extension'} uses proposed parts (${parts.join(', ')}). They work under ruimte extension dev, and an install from the store or of this pack is refused.`;
}

/*
 * Why `define` may not register `id`, checked after its permission: the kind is proposed and not named, the extension
 * came a way a proposed part does not work for, or the manifest does not list the id. Null when it may.
 */
export function providerRefusal(manifest: ProvidingManifest, define: string, id: string, proposedAllowed: boolean): string | null {
    const found = providerPointOf(define);

    if (found === null) {
        return `${define} registers nothing this Ruimte takes from an extension`;
    }

    const { kind, point } = found;

    if (point.proposed && !(manifest.proposed ?? []).includes(kind)) {
        return `${define} is still proposed; name ${kind} under proposed in manifest.json`;
    }

    if (point.proposed && !proposedAllowed) {
        return `${define} is still proposed, which an installed extension cannot use`;
    }

    return (manifest.provides?.[kind] ?? []).includes(id) ? null : `${define} got ${id}, which manifest.json does not list under provides.${kind}`;
}

/* The ids of one kind a manifest may supply here: listed, with the permission, and proposed only where that works. */
export function providedIds(manifest: ProvidingManifest, kind: string, proposedAllowed: boolean): readonly string[] {
    const point = pointOf(kind);

    if (point === null || !Object.hasOwn(manifest.permissions ?? {}, point.permission)) {
        return [];
    }

    if (point.proposed && (!proposedAllowed || !(manifest.proposed ?? []).includes(kind))) {
        return [];
    }

    return manifest.provides?.[kind] ?? [];
}
