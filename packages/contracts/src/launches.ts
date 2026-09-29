import { z } from 'zod';
import { ProjectIdSchema, ProjectSaveResultSchema } from './project.ts';

/*
 * A launch is a command a project keeps ready to run: a service that stays up (a web server, a dev
 * server), a task that runs to its end (tests, a build) or a group that starts several at once. The
 * names say `LaunchConfig` because `AgentLaunch` already means how an agent CLI starts.
 */
export const LaunchConfigKindSchema = z.enum(['service', 'task', 'group']);
export type LaunchConfigKind = z.infer<typeof LaunchConfigKindSchema>;

export const LaunchConfigEnvSchema = z.record(z.string(), z.string());
export type LaunchConfigEnv = z.infer<typeof LaunchConfigEnvSchema>;

export const LAUNCHES_VERSION = 1;

/* Loose, so a field a newer release writes survives a save by this one. */
export const LaunchConfigSchema = z.looseObject({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    kind: LaunchConfigKindSchema,
    // Relative to the project folder, POSIX; absent is the project folder itself. A group has none.
    cwd: z.string().optional(),
    command: z.string().optional(),
    // A service with an address counts as running only once its port takes a connection. A task has none.
    url: z.string().optional(),
    env: LaunchConfigEnvSchema.optional(),
    // The launch ids a group starts, in order. Only a group has them.
    launches: z.array(z.string().min(1)).optional(),
    // Starts with the project, and only on a machine where a person approved it.
    autostart: z.boolean().optional()
});
export type LaunchConfig = z.infer<typeof LaunchConfigSchema>;

/* What a shared launch holds on this machine only: an absolute path, or a variable such as a token. */
export const LaunchConfigOverlaySchema = z.looseObject({
    cwd: z.string().optional(),
    // Laid over the shared env, a key here winning.
    env: LaunchConfigEnvSchema.optional()
});
export type LaunchConfigOverlay = z.infer<typeof LaunchConfigOverlaySchema>;

/*
 * `.ruimte/launches.json`. Its entries are read one by one, so an entry of a kind this release does
 * not know is kept as it stands and written back where it was.
 */
export const LaunchesSharedFileSchema = z.looseObject({
    version: z.number().int().positive(),
    launches: z.array(z.unknown())
});
export type LaunchesSharedFile = z.infer<typeof LaunchesSharedFileSchema>;

/* `.ruimte/private/launches.json`: this person's launches, the order of the menu over both files, and the overlays. */
export const LaunchesPrivateFileSchema = z.looseObject({
    version: z.number().int().positive(),
    // Goes up by one on every write; a save that names an older rev is a conflict.
    rev: z.number().int().nonnegative(),
    // Launch ids over both files. An id missing from it goes after the ones it names.
    order: z.array(z.string()).optional(),
    launches: z.array(z.unknown()).optional(),
    // By the id of a shared launch.
    overlays: z.record(z.string(), LaunchConfigOverlaySchema).optional()
});
export type LaunchesPrivateFile = z.infer<typeof LaunchesPrivateFileSchema>;

/* One launch as a client edits it: which file it lives in, and for a shared one what stays on this machine. */
export const LaunchConfigEntrySchema = LaunchConfigSchema.extend({
    shared: z.boolean(),
    overlay: LaunchConfigOverlaySchema.optional()
});
export type LaunchConfigEntry = z.infer<typeof LaunchConfigEntrySchema>;

export const LaunchesDocumentSchema = z.object({
    rev: z.number().int().nonnegative(),
    // In the order of the menu.
    launches: z.array(LaunchConfigEntrySchema),
    // The launches a person on this machine approved as they stand now; a group is approved when all it starts is.
    approved: z.array(z.string())
});
export type LaunchesDocument = z.infer<typeof LaunchesDocumentSchema>;

export const LaunchesTargetPayloadSchema = z.object({
    projectId: ProjectIdSchema
});
export type LaunchesTargetPayload = z.infer<typeof LaunchesTargetPayloadSchema>;

export const LaunchesSavePayloadSchema = z.object({
    projectId: ProjectIdSchema,
    baseRev: z.number().int().nonnegative(),
    launches: z.array(LaunchConfigEntrySchema)
});
export type LaunchesSavePayload = z.infer<typeof LaunchesSavePayloadSchema>;

export const LaunchesSaveResultSchema = ProjectSaveResultSchema;
export type LaunchesSaveResult = z.infer<typeof LaunchesSaveResultSchema>;

export const LaunchSuggestionSourceSchema = z.enum(['run-xml', 'package-json', 'composer-json']);
export type LaunchSuggestionSource = z.infer<typeof LaunchSuggestionSourceSchema>;

/* A launch the daemon found in the project's own files, ready to import. */
export const LaunchSuggestionSchema = z.object({
    launch: LaunchConfigSchema,
    source: LaunchSuggestionSourceSchema,
    // The file it came from, relative to the project folder.
    path: z.string(),
    // The type of run configuration or the script name, as the file says it.
    detail: z.string(),
    // A path in it points outside the project, so it goes in the private file unless a person says otherwise.
    private: z.boolean(),
    // The type of run configuration the import cannot read; the suggestion is shown but cannot be imported.
    unsupported: z.string().optional()
});
export type LaunchSuggestion = z.infer<typeof LaunchSuggestionSchema>;

export const LaunchesDetectResultSchema = z.object({
    suggestions: z.array(LaunchSuggestionSchema)
});
export type LaunchesDetectResult = z.infer<typeof LaunchesDetectResultSchema>;

export const LaunchStartPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    launchId: z.string().min(1),
    // A person said yes to what the launch runs, as it stands now.
    approve: z.boolean().optional(),
    // Stop the launch that holds the port first.
    replace: z.boolean().optional()
});
export type LaunchStartPayload = z.infer<typeof LaunchStartPayloadSchema>;

/* What waits on a person's approval before it may run here. */
export const LaunchHeldSchema = z.object({
    launchId: z.string(),
    command: z.string(),
    // Absolute, where it would run.
    cwd: z.string()
});
export type LaunchHeld = z.infer<typeof LaunchHeldSchema>;

export const LaunchBusySchema = z.object({
    projectId: ProjectIdSchema,
    launchId: z.string(),
    port: z.number().int()
});
export type LaunchBusy = z.infer<typeof LaunchBusySchema>;

export const LaunchStartResultSchema = z.object({
    // `held`: nothing started, `held` says what needs approval. `busy`: nothing started, another launch has the port.
    outcome: z.enum(['started', 'held', 'busy']),
    held: z.array(LaunchHeldSchema).optional(),
    busy: LaunchBusySchema.optional()
});
export type LaunchStartResult = z.infer<typeof LaunchStartResultSchema>;

export const LaunchStopPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    launchId: z.string().min(1),
    // SIGKILL at once, which only a person's Force stop asks for.
    force: z.boolean().optional()
});
export type LaunchStopPayload = z.infer<typeof LaunchStopPayloadSchema>;

export const LaunchStateSchema = z.enum(['starting', 'running', 'stopping', 'exited']);
export type LaunchState = z.infer<typeof LaunchStateSchema>;

/* A launch that ran on this machine since the daemon started; one that never ran has none. */
export const LaunchStatusSchema = z.object({
    projectId: ProjectIdSchema,
    launchId: z.string(),
    // The terminal its output is in, which a client attaches to like any session.
    sessionId: z.string(),
    kind: LaunchConfigKindSchema,
    state: LaunchStateSchema,
    // Once exited: the command's own exit code.
    exitCode: z.number().int().nullable(),
    // Milliseconds since the epoch.
    startedAt: z.number(),
    endedAt: z.number().nullable(),
    // The port it waits on, or listens on once running.
    port: z.number().int().nullable(),
    url: z.string().nullable(),
    // Stopped by a person or an agent rather than on its own.
    stopped: z.boolean()
});
export type LaunchStatus = z.infer<typeof LaunchStatusSchema>;

export const LaunchListResultSchema = z.object({
    launches: z.array(LaunchStatusSchema)
});
export type LaunchListResult = z.infer<typeof LaunchListResultSchema>;

// A file changed: a save by another client, a hand edit, a pull, or an approval on this machine.
export const LaunchesChangedEventSchema = z.object({
    projectId: ProjectIdSchema,
    document: LaunchesDocumentSchema
});
export type LaunchesChangedEvent = z.infer<typeof LaunchesChangedEventSchema>;

/*
 * The port of an address, or null when it names none a launch can wait on. An address without a
 * port gets the scheme's own, so `http://localhost` waits on 80.
 */
export const launchPortOf = (url: string | undefined): number | null => {
    if (url === undefined || url.trim() === '') {
        return null;
    }
    let parsed: URL;
    try {
        parsed = new URL(url.trim());
    } catch {
        return null;
    }
    if (parsed.port !== '') {
        return Number(parsed.port);
    }
    if (parsed.protocol === 'http:') {
        return 80;
    }
    if (parsed.protocol === 'https:') {
        return 443;
    }
    return null;
};

/* An entry of a launches file as it stands: a launch this release reads, or one it keeps untouched. */
export type LaunchFileEntry = { launch: LaunchConfig } | { raw: unknown };

export const readLaunchEntries = (entries: readonly unknown[]): LaunchFileEntry[] =>
    entries.map((raw) => {
        const parsed = LaunchConfigSchema.safeParse(raw);
        return parsed.success ? { launch: parsed.data } : { raw };
    });
