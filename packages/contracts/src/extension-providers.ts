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
    notificationChannels: { define: 'defineNotificationChannel', permission: 'notifications.provide', proposed: true },
    uiSources: { define: 'defineUiSource', permission: 'ui.provide', proposed: true },
    references: { define: 'defineReference', permission: 'composer.provide', proposed: true },
    slashCommands: { define: 'defineSlashCommand', permission: 'composer.provide', proposed: true }
};

/* One part of `@ruimte/extension/client` that is still proposed: a function a manifest names under `proposed` before it may call it. */
export interface ExtensionClientPoint {
    /* The function of `@ruimte/extension/client` that registers one. */
    readonly define: string;
    readonly proposed: boolean;
}

/*
 * The parts of the client that are held like a provider point, by the name `proposed` takes. The client lists nothing
 * before its code runs, so a part here has no ids under `provides` and no permission of its own.
 */
export const EXTENSION_CLIENT_POINTS: Readonly<Record<string, ExtensionClientPoint>> = {
    projectSettings: { define: 'defineProjectSettings', proposed: true },
    languages: { define: 'defineLanguage', proposed: true },
    editorDecorations: { define: 'defineEditorDecoration', proposed: true }
};

/* What a mark in the editor's margin may say: a fixed set, each drawn in a color of Ruimte's own. */
export const EDITOR_DECORATION_KINDS = ['info', 'success', 'warning', 'error', 'muted'] as const;
export type EditorDecorationKind = (typeof EDITOR_DECORATION_KINDS)[number];

// The most marks one decoration puts in one file; the rest is cut, so a source cannot fill the margin of a long file twice over.
export const MAX_EDITOR_DECORATIONS = 2000;

/* A mark as the editor draws it: lines counted from 1, the last one included. */
export interface EditorDecorationMark {
    readonly line: number;
    readonly endLine: number;
    readonly kind: EditorDecorationKind;
}

/* The marks of an answer the editor draws: those with a line from 1 and a kind of the set, up to the most one file takes. */
export function editorDecorationsOf(answer: unknown): EditorDecorationMark[] {
    const marks: EditorDecorationMark[] = [];

    for (const each of Array.isArray(answer) ? answer : []) {
        const { line, endLine, kind } = (typeof each === 'object' && each !== null ? each : {}) as { line?: unknown; endLine?: unknown; kind?: unknown };

        if (marks.length >= MAX_EDITOR_DECORATIONS) {
            break;
        }

        if (typeof line === 'number' && Number.isInteger(line) && line >= 1 && (EDITOR_DECORATION_KINDS as readonly unknown[]).includes(kind)) {
            const last = typeof endLine === 'number' && Number.isInteger(endLine) && endLine >= line ? endLine : line;

            marks.push({ line, endLine: last, kind: kind as EditorDecorationKind });
        }
    }

    return marks;
}

// The most a grammar of an extension's language holds, as the bytes of its JSON file in the pack.
export const MAX_LANGUAGE_GRAMMAR_BYTES = 512 * 1024;

interface DefinedLanguage {
    readonly id?: unknown;
    readonly name?: unknown;
    readonly extensions?: unknown;
    readonly filenames?: unknown;
    readonly grammar?: unknown;
}

function names(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every((each) => typeof each === 'string' && each.length > 0 && each.length <= 64 && !/[\\/]/.test(each));
}

/*
 * Why a language an extension defines is none Ruimte takes, or null: an id the highlighter and a language server can
 * name, files it covers, and a grammar that is a JSON file of its own pack.
 */
export function languageProblem(language: DefinedLanguage): string | null {
    const { id, name, extensions, filenames = [], grammar } = language;

    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(id)) {
        return 'defineLanguage: id is lowercase letters, digits and dashes, starting with a letter';
    }

    if (typeof name !== 'string' || name.length === 0 || name.length > 60) {
        return `defineLanguage ${id}: name is 1 to 60 characters`;
    }

    if (!names(extensions) || !names(filenames) || extensions.length + filenames.length === 0 || extensions.length + filenames.length > 32) {
        return `defineLanguage ${id}: extensions and filenames are 1 to 32 names without a slash, such as lintel or Lintelfile`;
    }

    if (typeof grammar !== 'string' || !/^[^/.:][^:]*\.json$/.test(grammar) || grammar.split('/').includes('..')) {
        return `defineLanguage ${id}: grammar is the path of a JSON file in the pack, such as assets/${id}.tmLanguage.json`;
    }

    return null;
}

/* The language of an extension a file is in, by its name: a whole file name first, then what follows its last dot. */
export function definedLanguageOf<Language extends { readonly extensions: readonly string[]; readonly filenames: readonly string[] }>(
    languages: readonly Language[],
    path: string
): Language | null {
    const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).toLowerCase();
    const dot = name.lastIndexOf('.');
    const extension = dot <= 0 ? null : name.slice(dot + 1);

    return (
        languages.find((language) => language.filenames.some((each) => each.toLowerCase() === name)) ??
        (extension === null ? null : (languages.find((language) => language.extensions.some((each) => each.toLowerCase() === extension)) ?? null))
    );
}

// The most launches one launch source lists in a project; the rest is cut, so a source cannot fill the menu.
export const MAX_SOURCED_LAUNCHES = 64;

// The most places one machine source lists in a project, and the most programs one start runs.
export const MAX_MACHINE_CANDIDATES = 16;
export const MAX_MACHINE_STEPS = 16;

/*
 * The one source of a UI block that reads from an extension: `@Query("extension", { source, args })`. The sources a
 * block may name are fixed when the machine starts, so an extension's own goes in the arguments.
 */
export const EXTENSION_UI_SOURCE = 'extension';

// What a UI source says of itself to the agent that writes a block, and the most its answer holds.
export const MAX_UI_SOURCE_DESCRIPTION = 200;
export const MAX_UI_SOURCE_PARAMETERS_BYTES = 2048;
export const MAX_UI_SOURCE_ANSWER_BYTES = 32_768;

// What the machine takes of a reference and a slash command of `server/`: the things one reference lists, and the text one puts in a prompt.
export const MAX_REFERENCE_ITEMS = 200;
export const MAX_COMPOSER_TEXT = 100_000;

/* The name a UI source of an extension goes by in a block, which no source of Ruimte's own can have: those hold no slash. */
export function uiSourceName(extension: string, source: string): string {
    return `${extension}/${source}`;
}

/* The id a launch of a source goes by among a project's launches, which says the extension and the source it has to come from. */
export function sourcedLaunchId(extension: string, source: string, launch: string): string {
    return `${extension}:${source}:${launch}`;
}

/* The names a manifest may list under `proposed`. */
export const EXTENSION_PROPOSED_PARTS: readonly string[] = [
    ...Object.keys(EXTENSION_PROVIDER_POINTS).filter((kind) => EXTENSION_PROVIDER_POINTS[kind]?.proposed === true),
    ...Object.keys(EXTENSION_CLIENT_POINTS).filter((kind) => EXTENSION_CLIENT_POINTS[kind]?.proposed === true)
];

/* The key a project's setting of an extension is kept under in what that extension stores on the machine, which `server/` reads too. */
export function projectSettingKey(projectId: string, key: string): string {
    return `project:${projectId}:setting.${key}`;
}

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

/*
 * Why the client may not call `define`: it is still proposed and the manifest does not name it, or the extension came a
 * way a proposed part does not work for. Null when it may, and for a function that is no proposed part.
 */
export function clientPointRefusal(manifest: ProvidingManifest, define: string, proposedAllowed: boolean): string | null {
    const kind = Object.keys(EXTENSION_CLIENT_POINTS).find((each) => EXTENSION_CLIENT_POINTS[each]?.define === define);

    if (kind === undefined || EXTENSION_CLIENT_POINTS[kind]?.proposed !== true) {
        return null;
    }

    if (!(manifest.proposed ?? []).includes(kind)) {
        return `${define} is still proposed; name ${kind} under proposed in manifest.json`;
    }

    return proposedAllowed ? null : `${define} is still proposed, which an installed extension cannot use`;
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
