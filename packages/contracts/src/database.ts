import { z } from 'zod';
import { ProjectIdSchema } from './project.ts';

/*
 * `@adecore/database/host` checks every request whole with its `parseRequest` before anything reaches
 * the helper, and answers the package's own `DatabaseResponse`, so the wire leaves both opaque rather
 * than describe the package's protocol a second time.
 */
export const DatabaseRequestPayloadSchema = z.unknown();
export const DatabaseRequestResultSchema = z.unknown();

export const DATABASES_VERSION = 1;

/*
 * Loose, and only as strict as the files need: the host checks the whole config on every `open` and
 * `test`, and a field a newer release adds survives a save by this one. On the wire a SQLite `path`
 * is absolute; in a file it is relative to the project folder when the file lies inside it.
 */
export const DatabaseConnectionConfigSchema = z.discriminatedUnion('engine', [
    z.looseObject({ engine: z.literal('sqlite'), path: z.string().min(1) }),
    z.looseObject({ engine: z.literal('mysql') })
]);
export type DatabaseConnectionConfig = z.infer<typeof DatabaseConnectionConfigSchema>;

/* A connection as a file holds it. Never with a password: that lives in the desktop app's secret store. */
export const DatabaseConnectionEntrySchema = z.looseObject({
    id: z.string().min(1),
    name: z.string(),
    config: DatabaseConnectionConfigSchema
});
export type DatabaseConnectionEntry = z.infer<typeof DatabaseConnectionEntrySchema>;

/* A connection as a client edits it, with the file it lives in. */
export const DatabaseConnectionSchema = DatabaseConnectionEntrySchema.extend({
    shared: z.boolean()
});
export type DatabaseConnection = z.infer<typeof DatabaseConnectionSchema>;

/*
 * `.ruimte/databases.json`. Its entries are read one by one, so a connection this release cannot
 * read is kept as it stands and written back where it was.
 */
export const DatabasesSharedFileSchema = z.looseObject({
    version: z.number().int().positive(),
    connections: z.array(z.unknown())
});
export type DatabasesSharedFile = z.infer<typeof DatabasesSharedFileSchema>;

/* `.ruimte/private/databases.json`: the rev, this person's own connections and the order over both files. */
export const DatabasesPrivateFileSchema = z.looseObject({
    version: z.number().int().positive(),
    // Goes up by one on every write; a save that names an older rev is a conflict.
    rev: z.number().int().nonnegative(),
    connections: z.array(z.unknown()).optional(),
    // Connection ids over both files. An id missing from it goes after the ones it names.
    order: z.array(z.string()).optional()
});
export type DatabasesPrivateFile = z.infer<typeof DatabasesPrivateFileSchema>;

export const DatabaseConnectionsSchema = z.object({
    rev: z.number().int().nonnegative(),
    // In the order of the panel.
    connections: z.array(DatabaseConnectionSchema)
});
export type DatabaseConnections = z.infer<typeof DatabaseConnectionsSchema>;

export const DatabaseConnectionsPayloadSchema = z.object({
    projectId: ProjectIdSchema
});
export type DatabaseConnectionsPayload = z.infer<typeof DatabaseConnectionsPayloadSchema>;

/* The whole list, against the rev it was read at. A password in a config is dropped, never written. */
export const DatabaseConnectionsSavePayloadSchema = z.object({
    projectId: ProjectIdSchema,
    baseRev: z.number().int().nonnegative(),
    connections: z.array(DatabaseConnectionSchema)
});
export type DatabaseConnectionsSavePayload = z.infer<typeof DatabaseConnectionsSavePayloadSchema>;

// A file changed: a save by another client, a hand edit or a pull.
export const DatabaseConnectionsChangedEventSchema = DatabaseConnectionsSchema.extend({
    projectId: ProjectIdSchema
});
export type DatabaseConnectionsChangedEvent = z.infer<typeof DatabaseConnectionsChangedEventSchema>;

/*
 * What an agent may do with a connection: nothing, read through `page` on a read-only session, or
 * also write through `execute`. A connection a person never set is `read`.
 */
export const DatabaseAgentAccessSchema = z.enum(['off', 'read', 'write']);
export type DatabaseAgentAccess = z.infer<typeof DatabaseAgentAccessSchema>;

/* By connection id, only what a person set; kept under `$RUIMTE_HOME`, never in the project. */
export const DatabaseAgentAccessMapSchema = z.object({
    access: z.record(z.string(), DatabaseAgentAccessSchema)
});
export type DatabaseAgentAccessMap = z.infer<typeof DatabaseAgentAccessMapSchema>;

/* `write` only from a client that presented the local secret. */
export const DatabaseAgentAccessSetPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    connectionId: z.string().min(1),
    access: DatabaseAgentAccessSchema
});
export type DatabaseAgentAccessSetPayload = z.infer<typeof DatabaseAgentAccessSetPayloadSchema>;

export const DatabaseAgentAccessChangedEventSchema = DatabaseAgentAccessMapSchema.extend({
    projectId: ProjectIdSchema
});
export type DatabaseAgentAccessChangedEvent = z.infer<typeof DatabaseAgentAccessChangedEventSchema>;

/*
 * Every password this client holds for the project's connections, by connection id, replacing what it
 * handed over before. The daemon keeps them in memory only, for the agents of the project, until the
 * last client lets the project go.
 */
export const DatabasePasswordsPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    passwords: z.record(z.string().min(1), z.string())
});
export type DatabasePasswordsPayload = z.infer<typeof DatabasePasswordsPayloadSchema>;

/* An entry of a connections file as it stands: a connection this release reads, or one it keeps untouched. */
export type DatabaseFileEntry = { connection: DatabaseConnectionEntry } | { raw: unknown };

export function readDatabaseEntries(entries: readonly unknown[]): DatabaseFileEntry[] {
    return entries.map((raw) => {
        const parsed = DatabaseConnectionEntrySchema.safeParse(raw);
        return parsed.success ? { connection: parsed.data } : { raw };
    });
}
