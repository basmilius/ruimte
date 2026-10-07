import { z } from 'zod';
import { ProjectIdSchema, ProjectSqlSchema, SqlBindingSchema } from './project.ts';

/* A schema snapshot the machine holds for a connection, as a client lists it beside the choices. */
export const SqlSnapshotInfoSchema = z.object({
    connectionId: z.string().min(1),
    // Null is the snapshot of every database a connection that starts in none can see.
    database: z.string().min(1).nullable(),
    // `sqlite`, `mysql` or `mariadb`, as the server said when it was taken.
    dialect: z.string().min(1),
    version: z.string().optional(),
    // ISO 8601.
    takenAt: z.string().min(1),
    tables: z.number().int().nonnegative()
});
export type SqlSnapshotInfo = z.infer<typeof SqlSnapshotInfoSchema>;

export const LanguageSqlPayloadSchema = z.object({
    projectId: ProjectIdSchema
});
export type LanguageSqlPayload = z.infer<typeof LanguageSqlPayloadSchema>;

/* What the person chose for the SQL of the project, and the snapshots the machine holds of its connections. */
export const LanguageSqlStateSchema = z.object({
    sql: ProjectSqlSchema,
    snapshots: z.array(SqlSnapshotInfoSchema)
});
export type LanguageSqlState = z.infer<typeof LanguageSqlStateSchema>;

/*
 * A person's choice for one file, by its stored path, or for the project's default without a path.
 * Null takes the choice away: the file follows the default again, and the project has no default.
 */
export const LanguageSqlBindPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    path: z.string().min(1).optional(),
    binding: SqlBindingSchema.nullable()
});
export type LanguageSqlBindPayload = z.infer<typeof LanguageSqlBindPayloadSchema>;

/* Takes the snapshots of one connection again, or of every connection of the project; `schema` narrows it to the snapshots that hold it. */
export const DatabaseSnapshotRefreshPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    connectionId: z.string().min(1).optional(),
    schema: z.string().min(1).optional()
});
export type DatabaseSnapshotRefreshPayload = z.infer<typeof DatabaseSnapshotRefreshPayloadSchema>;

// A choice changed, or a snapshot was taken or went: to every client that has the project open.
export const LanguageSqlChangedEventSchema = LanguageSqlStateSchema.extend({
    projectId: ProjectIdSchema
});
export type LanguageSqlChangedEvent = z.infer<typeof LanguageSqlChangedEventSchema>;
