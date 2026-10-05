import { z } from 'zod';
import { ProjectIdSchema } from './project.ts';

/*
 * The language side of a project: the daemon runs the language servers, is their LSP client, and
 * keeps one server per project per kind, shared by every client of that project. A client opens a
 * document and asks for features; the daemon owns the version of the text and answers in LSP 3.17
 * shapes. A path is a stored path (`stored-path.ts`): relative to the project folder, POSIX, and
 * absolute only for a file outside it.
 */

/* A kind is one server, or for Vue a pair: `@vue/language-server` with a TypeScript server that loads `@vue/typescript-plugin`. */
export const LanguageServerKindSchema = z.enum(['typescript', 'vue', 'php', 'css', 'html', 'json', 'yaml', 'python', 'bash', 'docker', 'eslint', 'tailwind']);
export type LanguageServerKind = z.infer<typeof LanguageServerKindSchema>;

/* The id a server of a person's own goes by: this prefix and an id the daemon made. */
export const CUSTOM_SERVER_PREFIX = 'custom:';

/* A kind of the catalog, or a server of a person's own. A string on the wire, since a newer daemon may add kinds. */
export type LanguageServerId = string;
export const LanguageServerIdSchema = z
    .string()
    .refine((id) => LanguageServerKindSchema.safeParse(id).success || id.startsWith(CUSTOM_SERVER_PREFIX), { message: 'Not a language server' });

export const LanguageServerStateSchema = z.enum([
    // Nothing is on this machine yet; a person presses Install.
    'not-installed',
    'installing',
    // Installed, and no document of the project needs it.
    'stopped',
    'starting',
    'ready',
    // Ready, and the server reports work in progress, such as loading a project.
    'indexing',
    // The process ended or never came up; only a person's restart brings it back.
    'crashed'
]);
export type LanguageServerState = z.infer<typeof LanguageServerStateSchema>;

export const LanguageServerStatusSchema = z.object({
    // Open on purpose: a client reading a reply whole must not refuse it for a kind a newer daemon adds.
    server: z.string(),
    state: LanguageServerStateSchema,
    // The version of the pinned package the kind is named after; empty for a server of a person's own.
    version: z.string(),
    // Open documents in the project that the server serves.
    documents: z.number().int().nonnegative(),
    // The reason behind `crashed`, or behind a kind that is `not-installed` after a failed install.
    message: z.string().optional(),
    // LSP `ServerCapabilities` of each process the kind runs, by its name (`typescript`, `vue`, `php`, `css`, ...). Once a server answered its handshake.
    capabilities: z.record(z.string(), z.unknown()).optional(),
    // Only for a server of a person's own, which has no entry in the catalog to name it.
    name: z.string().optional(),
    // What the server serves, as LSP language ids and file patterns. Only for a server of a person's own.
    languages: z.array(z.string()).optional(),
    patterns: z.array(z.string()).optional()
});
export type LanguageServerStatus = z.infer<typeof LanguageServerStatusSchema>;

export const LanguageStatusPayloadSchema = z.object({ projectId: ProjectIdSchema });
export const LanguageStatusResultSchema = z.object({ servers: z.array(LanguageServerStatusSchema) });
export type LanguageStatusResult = z.infer<typeof LanguageStatusResultSchema>;

/* The kinds install into `$RUIMTE_HOME/language-servers` for the whole machine, so no project is named. */
export const LanguageInstallPayloadSchema = z.object({ server: LanguageServerKindSchema });

export const LanguageServerTargetPayloadSchema = z.object({ projectId: ProjectIdSchema, server: LanguageServerIdSchema });

/* The status right after the request: an install answers while it runs and its end comes as an event, a restart answers once the server is up again, crashed again, or not installed. */
export const LanguageServerStatusResultSchema = z.object({ status: LanguageServerStatusSchema });

export const LanguageLogLineSchema = z.object({
    at: z.number().int().nonnegative(),
    // What wrote it: the installer, the server's own log and stderr, or the daemon about the server.
    stream: z.enum(['install', 'server', 'host']),
    text: z.string()
});
export type LanguageLogLine = z.infer<typeof LanguageLogLineSchema>;

/* A bounded tail of the log of the kind in this project, the last install of it included. */
export const LanguageLogResultSchema = z.object({ lines: z.array(LanguageLogLineSchema) });

/*
 * A language server a person added: the command that starts it over stdio and what it serves. It runs for
 * the projects named in `projects`, or for every project without it. Saving it is what approves
 * starting exactly this command, these arguments and this environment; any change needs a new save.
 */
export const CustomLanguageServerInputSchema = z
    .object({
        // Absent for a new server.
        id: LanguageServerIdSchema.optional(),
        name: z.string().trim().min(1).max(80),
        // An absolute path, or a command on the PATH of the machine.
        command: z.string().trim().min(1),
        args: z.array(z.string()),
        env: z.record(z.string(), z.string()).optional(),
        // LSP language ids, such as `zig` or `toml`.
        languages: z.array(z.string().trim().min(1)),
        // File patterns, such as `*.zig` or `templates/**` (`language-patterns.ts`).
        patterns: z.array(z.string().trim().min(1)),
        initializationOptions: z.unknown().optional(),
        // The folders of the projects it runs for. Absent: every project.
        projects: z.array(z.string().min(1)).optional()
    })
    .refine((server) => server.languages.length + server.patterns.length > 0, { message: 'A server needs a language or a file pattern to serve' });
export type CustomLanguageServerInput = z.infer<typeof CustomLanguageServerInputSchema>;

export const CustomLanguageServerSchema = z.object({
    id: LanguageServerIdSchema,
    name: z.string(),
    command: z.string(),
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()),
    languages: z.array(z.string()),
    patterns: z.array(z.string()),
    initializationOptions: z.unknown().optional(),
    projects: z.array(z.string()).optional(),
    // The file was changed outside Ruimte after it was approved, so the server does not start until it is saved again.
    held: z.boolean().optional()
});
export type CustomLanguageServer = z.infer<typeof CustomLanguageServerSchema>;

export const LanguageCustomListResultSchema = z.object({ servers: z.array(CustomLanguageServerSchema) });
export const LanguageCustomSavePayloadSchema = z.object({ server: CustomLanguageServerInputSchema });
export const LanguageCustomSaveResultSchema = z.object({ server: CustomLanguageServerSchema });
export const LanguageCustomRemovePayloadSchema = z.object({ id: LanguageServerIdSchema });
export const LanguageCustomCheckPayloadSchema = z.object({ command: z.string() });
// Whether the command is an executable on this machine, and where.
export const LanguageCustomCheckResultSchema = z.object({ found: z.boolean(), path: z.string().optional() });
export type LanguageCustomCheckResult = z.infer<typeof LanguageCustomCheckResultSchema>;

/* To every client: the servers of a person's own changed, so their statuses are asked for again. */
export const LanguageCustomChangedEventSchema = z.object({ servers: z.array(CustomLanguageServerSchema) });

export const LanguageDocumentTargetPayloadSchema = z.object({ projectId: ProjectIdSchema, path: z.string().min(1) });
export type LanguageDocumentTargetPayload = z.infer<typeof LanguageDocumentTargetPayloadSchema>;

/*
 * The text replaces what the daemon holds when another client already has the file open, so two
 * clients with different unsaved text take turns; the version in the answer is the one to change against.
 */
export const LanguageDocumentOpenPayloadSchema = LanguageDocumentTargetPayloadSchema.extend({
    languageId: z.string().min(1),
    text: z.string()
});
export type LanguageDocumentOpenPayload = z.infer<typeof LanguageDocumentOpenPayloadSchema>;

/* What each method of the document may ask, by LSP method, as the options its server gave (`{}` for a plain yes). Empty while no server is up. */
export const LanguageProvidersSchema = z.record(z.string(), z.unknown());
export type LanguageProviders = z.infer<typeof LanguageProvidersSchema>;

export const LanguageDocumentOpenResultSchema = z.object({
    version: z.number().int().positive(),
    // Which kinds serve the document, installed or not.
    servers: z.array(z.string()),
    providers: LanguageProvidersSchema
});
export type LanguageDocumentOpenResult = z.infer<typeof LanguageDocumentOpenResultSchema>;

/* One entry of `textDocument/didChange`: a range of the text it replaces, or without one the whole text. */
export const LanguageContentChangeSchema = z.object({
    range: z
        .object({
            start: z.object({ line: z.number().int().nonnegative(), character: z.number().int().nonnegative() }),
            end: z.object({ line: z.number().int().nonnegative(), character: z.number().int().nonnegative() })
        })
        .optional(),
    text: z.string()
});
export type LanguageContentChange = z.infer<typeof LanguageContentChangeSchema>;

/*
 * Every accepted change raises the version by one. A change that names another base than the one
 * the daemon is at is refused as `stale-document`, and the client opens the document again with its
 * whole text.
 */
export const LanguageDocumentChangePayloadSchema = LanguageDocumentTargetPayloadSchema.extend({
    baseVersion: z.number().int().positive(),
    changes: z.array(LanguageContentChangeSchema).min(1)
});
export type LanguageDocumentChangePayload = z.infer<typeof LanguageDocumentChangePayloadSchema>;

export const LanguageDocumentChangeResultSchema = z.object({ version: z.number().int().positive() });

/* The codes a language request can fail with, besides the generic ones every request has. */
export const LANGUAGE_ERROR_CODES = {
    // The client's base or version is not the one the daemon holds, so the client opens the document again.
    staleDocument: 'stale-document',
    documentNotOpen: 'document-not-open',
    // No server of the kind is up: not installed, still starting, or crashed.
    unavailable: 'language-unavailable',
    unsupported: 'language-unsupported',
    cancelled: 'language-cancelled',
    // The server answered with an error.
    failed: 'language-failed',
    badPath: 'bad-path',
    projectNotFound: 'project-not-found',
    installFailed: 'install-failed',
    // A server of a person's own that cannot be saved: the command is not there, or nothing says what it serves.
    invalidServer: 'invalid-server'
} as const;
export type LanguageErrorCode = (typeof LANGUAGE_ERROR_CODES)[keyof typeof LANGUAGE_ERROR_CODES];

/* The LSP methods a client may ask of a document. The daemon adds the `textDocument` itself. */
export const LANGUAGE_METHODS = [
    'textDocument/completion',
    'completionItem/resolve',
    'textDocument/hover',
    'textDocument/signatureHelp',
    'textDocument/definition',
    'textDocument/declaration',
    'textDocument/typeDefinition',
    'textDocument/implementation',
    'textDocument/references',
    'textDocument/documentHighlight',
    'textDocument/documentSymbol',
    'textDocument/prepareRename',
    'textDocument/rename',
    'textDocument/codeAction',
    'codeAction/resolve',
    'textDocument/codeLens',
    'codeLens/resolve',
    'textDocument/formatting',
    'textDocument/rangeFormatting',
    'textDocument/foldingRange',
    'textDocument/semanticTokens/full',
    'textDocument/semanticTokens/full/delta',
    'textDocument/semanticTokens/range',
    'textDocument/inlayHint',
    'inlayHint/resolve',
    // Asked of the server that serves the document, for a name in a snippet that is no document of its own.
    'workspace/symbol'
] as const;
export const LanguageMethodSchema = z.enum(LANGUAGE_METHODS);
export type LanguageMethod = z.infer<typeof LanguageMethodSchema>;

/*
 * `params` are the LSP 3.17 params of the method without `textDocument`; for a `/resolve` method
 * they are the item itself. `version` is the version the client believes the document is at, and the
 * request is refused as `stale-document` when it is not. `server` names the process that produced
 * an item being resolved, as an earlier answer said.
 */
export const LanguageRequestPayloadSchema = LanguageDocumentTargetPayloadSchema.extend({
    method: LanguageMethodSchema,
    params: z.unknown(),
    version: z.number().int().positive().optional(),
    server: z.string().optional()
});
export type LanguageRequestPayload = z.infer<typeof LanguageRequestPayloadSchema>;

/*
 * `result` is the LSP 3.17 result of the method, `server` the process that answered and `version` the
 * version it answered for. When several servers answered and their lists were merged, `itemServers`
 * names the process of each item (of the list, or of its `items`), so an item resolves against the
 * process that made it.
 */
export const LanguageRequestResultSchema = z.object({
    result: z.unknown(),
    server: z.string(),
    version: z.number().int().positive(),
    itemServers: z.array(z.string()).optional()
});
export type LanguageRequestResult = z.infer<typeof LanguageRequestResultSchema>;

/*
 * `workspace/executeCommand` of the server that answered the action the command came from (`server`, as
 * that answer said), or of the document's first server that supports it. A command may make the server
 * ask for an edit, which the daemon forwards to the client that ran the command as `language.edit` and
 * answers the server from `language.edit.answer`; a server's edit request with no command of a client
 * running is refused. The edit is applied by the client, never by the daemon.
 */
export const LanguageCommandPayloadSchema = LanguageDocumentTargetPayloadSchema.extend({
    command: z.string().min(1),
    arguments: z.array(z.unknown()).optional(),
    server: z.string().optional()
});
export type LanguageCommandPayload = z.infer<typeof LanguageCommandPayloadSchema>;

export const LanguageCommandResultSchema = z.object({ result: z.unknown(), server: z.string() });
export type LanguageCommandResult = z.infer<typeof LanguageCommandResultSchema>;

/* To the one client that ran a command: a server asks it to apply an LSP `WorkspaceEdit`, which it answers with `language.edit.answer`. */
export const LanguageEditEventSchema = z.object({
    projectId: ProjectIdSchema,
    editId: z.string().min(1),
    label: z.string().optional(),
    // LSP `WorkspaceEdit`.
    edit: z.unknown()
});
export type LanguageEditEvent = z.infer<typeof LanguageEditEventSchema>;

export const LanguageEditAnswerPayloadSchema = z.object({
    projectId: ProjectIdSchema,
    editId: z.string().min(1),
    applied: z.boolean(),
    failureReason: z.string().optional()
});
export type LanguageEditAnswerPayload = z.infer<typeof LanguageEditAnswerPayloadSchema>;

/* To every client that has the project open, from one process of the kind. A report replaces the earlier one of the same `server` for the file. */
export const LanguageDiagnosticsEventSchema = z.object({
    projectId: ProjectIdSchema,
    path: z.string(),
    server: z.string(),
    version: z.number().int().positive().optional(),
    // LSP `Diagnostic[]`.
    diagnostics: z.array(z.unknown())
});
export type LanguageDiagnosticsEvent = z.infer<typeof LanguageDiagnosticsEventSchema>;

/* A null project is the machine: an install started, ended or failed, which every client hears. */
export const LanguageStatusEventSchema = z.object({
    projectId: ProjectIdSchema.nullable(),
    status: LanguageServerStatusSchema
});
export type LanguageStatusEvent = z.infer<typeof LanguageStatusEventSchema>;

/* A server came up, registered a feature or asked for a refresh: what a document may ask changed. */
export const LanguageProvidersEventSchema = z.object({
    projectId: ProjectIdSchema,
    path: z.string(),
    providers: LanguageProvidersSchema
});
export type LanguageProvidersEvent = z.infer<typeof LanguageProvidersEventSchema>;
