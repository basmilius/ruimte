import {
    CliVersionSchema,
    RegistryCatalogSchema,
    AgentKindSchema,
    ChatVisualSchema,
    DatabaseAgentAccessSchema,
    TEMPLATE_LANGUAGES,
    TEMPLATE_LIMITS,
    TEMPLATE_PLACES,
    UsageProviderSchema
} from '@ruimte/contracts';
import { z } from 'zod';
import {
    PERSON_AND_VOICE,
    AGENT,
    PERSON,
    databaseConnection,
    databaseSchema,
    languagePath,
    languageLine,
    languageColumn,
    languageSpan,
    languageType,
    languageHead,
    DATABASE_QUERY_ROWS,
    DATABASE_QUERY_MAX_ROWS,
    usageDay,
    PaceSchema
} from './fields.ts';

export const DEVELOPER_ACTIONS = {
    /* The machine checks the request whole, so this passes it on unparsed and a grid that pages parses nothing twice. */
    'database.request': {
        title: 'Ask a database',
        description:
            'Sends one request of the database views to the machine of this project: a table, a page of rows, a query or a change a person made in a view, and its answer.',
        effect: 'external',
        domain: 'developer',
        actors: PERSON,
        input: z.object({ request: z.unknown().describe('A request of the database views, as they made it') }),
        output: z.object({ response: z.unknown() })
    },
    'database.list': {
        title: 'List database connections',
        description: 'Lists the database connections of the project, where each points and what agents may do with it; never a password.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({}),
        output: z.object({
            connections: z.array(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    engine: z.string(),
                    target: z.string(),
                    access: DatabaseAgentAccessSchema,
                    outsideProject: z.boolean()
                })
            )
        })
    },
    'database.tables': {
        title: 'List database tables',
        description: 'Lists the schemas of a database connection and the tables and views of one of them, with the row count the server estimates.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({
            connection: databaseConnection,
            schema: databaseSchema.describe("The schema whose tables to list; without it the connection's own database, or every schema when it has none")
        }),
        output: z.object({
            connection: z.string(),
            schemas: z.array(z.string()),
            tables: z.array(z.object({ schema: z.string(), name: z.string(), kind: z.string(), rowEstimate: z.number().nullable() }))
        })
    },
    'database.describe': {
        title: 'Describe a database table',
        description: 'Describes a table or view of a database connection: its columns, primary key, indexes and foreign keys.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({
            connection: databaseConnection,
            table: z.string().min(1).describe('The table or view, by name'),
            schema: databaseSchema.describe("The schema the table is in; without it the connection's own database")
        }),
        output: z.object({
            schema: z.string(),
            name: z.string(),
            kind: z.string(),
            columns: z.array(
                z.looseObject({
                    name: z.string(),
                    type: z.string(),
                    nullable: z.boolean(),
                    defaultValue: z.string().nullable(),
                    autoIncrement: z.boolean(),
                    generated: z.boolean()
                })
            ),
            primaryKey: z.array(z.string()),
            indexes: z.array(z.looseObject({ name: z.string(), columns: z.array(z.string()), unique: z.boolean(), primary: z.boolean() })),
            foreignKeys: z.array(
                z.looseObject({
                    name: z.string().nullable(),
                    columns: z.array(z.string()),
                    referencedSchema: z.string(),
                    referencedTable: z.string(),
                    referencedColumns: z.array(z.string()),
                    onUpdate: z.string().nullable(),
                    onDelete: z.string().nullable()
                })
            )
        })
    },
    /* A query that shows its rows publishes a visual the way `visual.show` does, under the same rules. */
    'database.query': {
        title: 'Query a database',
        description: 'Runs one statement that reads (SELECT or WITH) on a read-only session of a database connection and answers its first rows.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({
            connection: databaseConnection,
            sql: z.string().min(1).describe('One statement that starts with SELECT or WITH'),
            schema: databaseSchema.describe("The schema the statement runs in; without it the connection's own database"),
            limit: z.number().int().min(1).max(DATABASE_QUERY_MAX_ROWS).nullable().describe(`How many rows at most; ${DATABASE_QUERY_ROWS} without it`),
            show: z.string().nullable().describe('Also shows the rows as a table above your reply in this chat, under this title')
        }),
        output: z.object({
            connection: z.string(),
            schema: z.string().nullable(),
            columns: z.array(z.object({ name: z.string(), type: z.string(), kind: z.string() })),
            rows: z.array(z.array(z.unknown())),
            hasMore: z.boolean(),
            elapsedMs: z.number(),
            // What became of `show`: the visual, or why the table was not shown; null without `show`.
            shown: z.union([z.object({ visual: ChatVisualSchema }), z.object({ reason: z.string() })]).nullable()
        })
    },
    'database.execute': {
        title: 'Write to a database',
        description:
            'Runs one or more statements on a database connection a person allowed agents to write to, and answers what each did; never in the supervised mode.',
        effect: 'external',
        domain: 'developer',
        actors: AGENT,
        input: z.object({
            connection: databaseConnection,
            sql: z.string().min(1).describe('The statements, separated by semicolons'),
            schema: databaseSchema.describe("The schema the statements run in; without it the connection's own database")
        }),
        output: z.object({
            connection: z.string(),
            results: z.array(z.looseObject({ kind: z.enum(['rows', 'done', 'error']), sql: z.string(), elapsedMs: z.number() })),
            inTransaction: z.boolean()
        })
    },
    'language.diagnostics': {
        title: 'Read the problems of a file',
        description:
            "Reads what the project's language servers find in one file: errors, warnings, information and hints, each with where it sits and which server found it.",
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath }),
        output: z.object({
            ...languageHead,
            diagnostics: z.array(
                languageSpan.extend({
                    severity: z.enum(['error', 'warning', 'information', 'hint']),
                    server: z.string(),
                    source: z.string().nullable(),
                    code: z.string().nullable(),
                    message: z.string()
                })
            )
        })
    },
    'language.hover': {
        title: 'Read what a name in a file is',
        description: "Reads what the project's language servers say of the name at a place in a file: its type, signature and documentation.",
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath, line: languageLine, column: languageColumn }),
        output: z.object({ ...languageHead, contents: z.string().nullable() })
    },
    'language.definition': {
        title: 'Find where a name is defined',
        description: 'Finds where the name at a place in a file is defined, as the language servers of the project know it.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath, line: languageLine, column: languageColumn }),
        output: z.object({ ...languageHead, locations: z.array(languageSpan) })
    },
    'language.references': {
        title: 'Find where a name is used',
        description: 'Finds every place the name at a place in a file is used, its definition included, as the language servers of the project know it.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath, line: languageLine, column: languageColumn }),
        output: z.object({ ...languageHead, locations: z.array(languageSpan) })
    },
    'language.symbols': {
        title: 'List the symbols of a file',
        description: 'Lists what a file defines, such as classes, functions, tables and columns, nested as the language servers of the project see them.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath }),
        output: z.object({
            ...languageHead,
            symbols: z.array(
                z.object({
                    name: z.string(),
                    kind: z.string(),
                    detail: z.string().nullable(),
                    depth: z.number().int(),
                    line: z.number().int(),
                    column: z.number().int(),
                    endLine: z.number().int(),
                    endColumn: z.number().int()
                })
            )
        })
    },
    'language.problems': {
        title: 'Read the problems of the whole project',
        description:
            "Reads what the last whole-project check of the project's running language servers found in every file, also files nobody has open. It starts no check; a person does from the Problems panel.",
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({
            path: languagePath.nullable().describe('A file whose servers are started first; without it only servers already running are read')
        }),
        output: z.object({
            servers: z.array(z.object({ kind: z.string(), process: z.string() })),
            files: z.number().int(),
            diagnostics: z.array(
                languageSpan.extend({
                    severity: z.enum(['error', 'warning', 'information', 'hint']),
                    server: z.string(),
                    source: z.string().nullable(),
                    code: z.string().nullable(),
                    message: z.string()
                })
            ),
            truncated: z.boolean(),
            withheld: z.number().int(),
            pulled: z.boolean().optional().describe('False while no whole-project pull ran yet, which only a person starts')
        })
    },
    'language.supertypes': {
        title: 'Find the supertypes of a type',
        description: 'Finds what the type at a place in a file extends or implements, as the language servers of the project know it.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath, line: languageLine, column: languageColumn }),
        output: z.object({ ...languageHead, type: languageType.nullable(), types: z.array(languageType) })
    },
    'language.subtypes': {
        title: 'Find the subtypes of a type',
        description: 'Finds the types that extend or implement the type at a place in a file, as the language servers of the project know it.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath, line: languageLine, column: languageColumn }),
        output: z.object({ ...languageHead, type: languageType.nullable(), types: z.array(languageType) })
    },
    'language.sql': {
        title: 'Read what a SQL file is read against',
        description:
            'Reads which database connection, database and schema snapshot a .sql file of the project is read against, and the command that checks it from a shell.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ path: languagePath }),
        output: z.object({
            path: z.string(),
            source: z.enum(['file', 'console', 'default', 'none', 'unbound']),
            connection: z.object({ id: z.string(), name: z.string(), engine: z.string() }).nullable(),
            database: z.string().nullable(),
            dialect: z.string().nullable(),
            version: z.string().nullable(),
            snapshot: z.string().nullable(),
            takenAt: z.string().nullable(),
            command: z.string(),
            installed: z.boolean()
        })
    },
    'template.list': {
        title: 'List the editor templates',
        description:
            'Lists the live and postfix templates the editor expands in this project: the built-in ones that are switched on, the ones of the person and the ones the project shares. A built-in template has no body here.',
        effect: 'read',
        domain: 'developer',
        actors: AGENT,
        input: z.object({ language: z.enum(TEMPLATE_LANGUAGES).nullish().describe('Only the templates that apply to this language family') }),
        output: z.object({
            templates: z.array(
                z.object({
                    id: z.string(),
                    kind: z.enum(['live', 'postfix']),
                    key: z.string(),
                    languages: z.array(z.string()),
                    source: z.enum(['built-in', 'personal', 'project']),
                    description: z.string().nullable(),
                    body: z.string().nullable()
                })
            )
        })
    },
    'template.add': {
        title: 'Add an editor template',
        description:
            "Adds a new template to the person's own set, marked as added by an agent. It never changes or removes a template, never writes the project's file, and refuses a key that an enabled template for one of the same languages already has.",
        effect: 'local',
        domain: 'developer',
        actors: AGENT,
        input: z.object({
            kind: z.enum(['live', 'postfix']).describe('A live template expands on Tab after its key; a postfix template wraps the expression before a dot'),
            key: z
                .string()
                .min(1)
                .max(TEMPLATE_LIMITS.key)
                .describe('What the person types; a live key has no whitespace, a postfix key holds letters, digits, _ and $'),
            body: z
                .string()
                .min(1)
                .max(TEMPLATE_LIMITS.body)
                .describe('The text in snippet syntax: $0 and ${1:name} are stops, and $EXPR is the expression of a postfix template'),
            languages: z
                .array(z.enum(TEMPLATE_LANGUAGES))
                .min(1)
                .describe('The language families it applies to; a postfix template takes javascript, typescript and php only'),
            description: z.string().max(TEMPLATE_LIMITS.description).nullish().describe('One line shown beside the template in the list'),
            places: z.array(z.enum(TEMPLATE_PLACES)).nullish().describe('Where a live template applies; code without it'),
            expression: z.enum(['any', 'statement']).nullish().describe('What a postfix template wraps; any without it')
        }),
        output: z.object({ id: z.string(), kind: z.enum(['live', 'postfix']), key: z.string() })
    },
    'provider.catalog': {
        title: 'Read the ACP registry',
        description:
            "Reads the agents of the public ACP registry this machine can run, with the version the registry names and whether each is installed here. Installing one stays a person's, in Settings, Providers.",
        effect: 'read',
        domain: 'machine',
        actors: AGENT,
        input: z.object({
            search: z.string().nullable().describe('Words the name, id or description of an agent holds; every agent without it'),
            refresh: z.boolean().nullable().describe('Reads the registry again instead of the copy of the last hour')
        }),
        output: RegistryCatalogSchema
    },
    'provider.versions': {
        title: 'Read the versions of the agent CLIs',
        description:
            "Reads the version of each agent CLI on this machine, how it was installed and whether that route offers a newer one. Updating one stays a person's, in Settings, Providers.",
        effect: 'read',
        domain: 'machine',
        actors: AGENT,
        input: z.object({ refresh: z.boolean().nullable().describe('Asks each route for its newest version again instead of the answer of the last hour') }),
        output: z.object({ versions: z.array(CliVersionSchema) })
    },
    'provider.limits': {
        title: 'Read the plan of my own account',
        description:
            'Reads the plan windows of the account the calling agent runs on, as its CLI last reported them: how much of each is used, when it resets and how that stands against an even pace. Nothing reads a credential or asks the provider.',
        effect: 'read',
        domain: 'machine',
        actors: AGENT,
        input: z.object({}),
        output: z.object({
            provider: AgentKindSchema,
            account: z.string().nullable().describe('The account by name; null on a machine without accounts'),
            plan: z.string().nullable(),
            checkedAt: z.iso.datetime().nullable().describe('When these numbers came in; null before the first read'),
            unavailable: z.string().nullable().describe('Why there are no windows, when there are none for a reason'),
            windows: z.array(
                z.object({
                    label: z.string(),
                    kind: z.string(),
                    usedPercent: z.number().int(),
                    resetsAt: z.iso.datetime().nullable(),
                    evenPacePercent: z
                        .number()
                        .int()
                        .nullable()
                        .describe('Where usedPercent would stand had the window been spent evenly from its start; null when the CLI named no reset or length'),
                    pace: PaceSchema.nullable().describe('ahead uses more than that even pace, behind less; null without one')
                })
            )
        })
    },
    'usage.summary': {
        title: 'Read AI usage',
        description:
            'Reads what the AI CLIs on the machine of this project used over a stretch of days, from their own transcripts: tokens, cost where a price is known, and the models and projects that used most.',
        effect: 'read',
        domain: 'machine',
        actors: PERSON_AND_VOICE,
        input: z.object({
            from: usageDay.nullable().describe('The first day, YYYY-MM-DD; seven days back without it'),
            to: usageDay.nullable().describe('The last day, YYYY-MM-DD; today without it')
        }),
        output: z.object({
            from: z.string(),
            to: z.string(),
            tokens: z.number().int(),
            // Null when no model used in the stretch has a known price, which is not the same as free.
            costUsd: z.number().nullable(),
            sessions: z.number().int(),
            providers: z.array(z.object({ provider: UsageProviderSchema, tokens: z.number().int(), costUsd: z.number().nullable() })),
            models: z.array(z.object({ provider: UsageProviderSchema, model: z.string(), tokens: z.number().int(), costUsd: z.number().nullable() })),
            projects: z.array(z.object({ name: z.string(), tokens: z.number().int(), costUsd: z.number() }))
        })
    },
    'usage.limits': {
        title: 'Read plan limits',
        description: 'Reads how far the plan windows of the AI CLIs on the machine of this project are used, as the CLIs report them.',
        effect: 'read',
        domain: 'machine',
        actors: PERSON_AND_VOICE,
        input: z.object({}),
        output: z.object({
            providers: z.array(
                z.object({
                    provider: UsageProviderSchema,
                    // A CLI with several accounts has an entry for each.
                    account: z.string().nullable().describe('The account these numbers are of, by name; null on a machine without accounts'),
                    plan: z.string().nullable(),
                    checkedAt: z.number(),
                    unavailable: z.string().nullable(),
                    windows: z.array(
                        z.object({
                            label: z.string(),
                            kind: z.string(),
                            usedPercent: z.number(),
                            resetsAt: z.number().nullable(),
                            evenPacePercent: z
                                .number()
                                .nullable()
                                .describe(
                                    'Where usedPercent would stand had the window been spent evenly from its start; above it is ahead of that pace. Null when the CLI named no reset or length'
                                )
                        })
                    )
                })
            )
        })
    }
} as const;
