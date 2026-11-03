import { z } from 'zod';
import { EmptySchema } from '@adecore/agent-contracts';

/* What a person's Ruimte promises an extension. It moves only when an extension built for the old one stops working. */
export const EXTENSION_API_VERSION = 1;

export const ExtensionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/);

/* Where a pack keeps its mark, the same for every extension, so a list needs no word from its code. */
export const EXTENSION_ICON_PATH = 'assets/icon.svg';

export const ExtensionManifestSchema = z.object({
    id: ExtensionIdSchema,
    name: z.string().min(1).max(80),
    version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/),
    api: z.number().int().positive(),
    description: z.string().max(280).optional(),
    publisher: z.string().max(80).optional(),
    category: z.string().max(40).optional(),
    // The ground of its mark, as #rrggbb.
    color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    // Starts `server/` with the machine, for an extension that follows events with no client open.
    autostart: z.boolean().optional(),
    // What it asks for, each with the reason a person reads before installing.
    permissions: z.record(z.string().min(1), z.string().min(1).max(200)).optional(),
    themes: z.array(z.string().min(1)).optional(),
    // When client/ loads, such as node:stamp or file:csv. Without it, with the app.
    activation: z.array(z.string().min(1)).optional()
});
export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>;

/* The picture of a theme, a file in its pack. */
export const EXTENSION_THEME_THUMBNAIL = /^[^/.][^:]*\.(png|jpe?g|webp|svg)$/i;
export const MAX_THEME_THUMBNAIL_BYTES = 256 * 1024;

// A URL parser drops tabs and line breaks anywhere and reads `https:host` as `https://host`.
function remote(target: string): boolean {
    return /^\s*(\/\/|[a-z][a-z0-9+.-]*:\/\/|(https?|wss?|ftp):)/i.test(target.replaceAll(/[\t\n\r]/g, ''));
}

function outsideThePack(target: string): boolean {
    const url = target.replaceAll(/[\t\n\r]/g, '');

    return /^\s*([a-z][a-z0-9+.-]*:|\/|\.\.)/i.test(url) || url.includes('/../');
}

/*
 * A theme's stylesheet and token values read only from its own pack, so a theme never phones home. A
 * quoted string may name no other host, since `image-set()` and `src()` load one, and an escape is
 * refused whole, since `\75rl(` is `url(` to the browser.
 */
export function extensionThemeCssProblem(css: string): string | null {
    if (css.includes('\\')) {
        return 'escapes are not allowed';
    }

    const text = css.replaceAll(/\/\*[\s\S]*?\*\//g, ' ');

    if (/@import/i.test(text)) {
        return '@import is not allowed';
    }

    for (const match of text.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
        const target = match[2] ?? '';

        if (outsideThePack(target)) {
            return `url(${target}) points outside the pack`;
        }
    }

    for (const match of text.matchAll(/"([^"]*)"|'([^']*)'/g)) {
        const target = match[1] ?? match[2] ?? '';

        if (remote(target)) {
            return `${target} points to another host`;
        }
    }

    return null;
}

/* A theme is data, read before any extension code runs. Tokens override the base of one side. */
export const ExtensionThemeSchema = z.object({
    name: z.string().min(1).max(80),
    side: z.enum(['light', 'dark']),
    // What the picker shows beside System, Light and Dark: a picture in the pack, 16:10.
    thumbnail: z.string().regex(EXTENSION_THEME_THUMBNAIL),
    tokens: z.record(
        z.string().regex(/^--[a-z0-9-]+$/),
        z
            .string()
            .regex(/^[^;{}]+$/)
            .superRefine((value, context) => {
                const problem = extensionThemeCssProblem(value);

                if (problem !== null) {
                    context.addIssue({ code: 'custom', message: problem });
                }
            })
    ),
    css: z.string().min(1).optional()
});
export type ExtensionTheme = z.infer<typeof ExtensionThemeSchema>;

/* A `.rex` is this object as gzipped JSON, with every file's bytes in base64. */
export const ExtensionPackSchema = z.object({
    files: z.record(z.string().min(1), z.string())
});
export type ExtensionPack = z.infer<typeof ExtensionPackSchema>;

/* A file in a pack stays inside its own folder, wherever it is unpacked. */
export function isSafePackPath(path: string): boolean {
    return !path.startsWith('/') && !path.includes('\\') && !path.split('/').some((part) => part === '' || part === '.' || part === '..');
}

export const ExtensionStatusSchema = z.enum(['idle', 'running', 'crashed', 'disabled']);
export type ExtensionStatus = z.infer<typeof ExtensionStatusSchema>;

export const ExtensionInfoSchema = z.object({
    manifest: ExtensionManifestSchema,
    hash: z.string().min(1),
    enabled: z.boolean(),
    hasServer: z.boolean(),
    hasClient: z.boolean().optional(),
    status: ExtensionStatusSchema,
    // Linked from a folder by `ruimte extension dev`, which is where a client on this machine reads it from.
    devFolder: z.string().optional(),
    revision: z.number().int().nonnegative().optional(),
    // Why its files could not be read. It does not run, and its manifest only names it by its id, so a person can remove it.
    error: z.string().optional()
});
export type ExtensionInfo = z.infer<typeof ExtensionInfoSchema>;

export const ExtensionListResultSchema = z.object({ extensions: z.array(ExtensionInfoSchema) });
export type ExtensionListResult = z.infer<typeof ExtensionListResultSchema>;

export const ExtensionInstallPayloadSchema = z.object({ pack: z.string().min(1) });
export type ExtensionInstallPayload = z.infer<typeof ExtensionInstallPayloadSchema>;

export const ExtensionIdPayloadSchema = z.object({ id: ExtensionIdSchema });
export type ExtensionIdPayload = z.infer<typeof ExtensionIdPayloadSchema>;

export const ExtensionSetEnabledPayloadSchema = z.object({ id: ExtensionIdSchema, enabled: z.boolean() });
export type ExtensionSetEnabledPayload = z.infer<typeof ExtensionSetEnabledPayloadSchema>;

export const ExtensionCallPayloadSchema = z.object({
    id: ExtensionIdSchema,
    method: z.string().min(1).max(120),
    args: z.array(z.unknown()).max(16)
});
export type ExtensionCallPayload = z.infer<typeof ExtensionCallPayloadSchema>;

export const ExtensionCallResultSchema = z.object({ result: z.unknown() });
export type ExtensionCallResult = z.infer<typeof ExtensionCallResultSchema>;

/* What a client keeps of an extension on the machine, where its `server/` reads the same keys. */
export const ExtensionStorageGetPayloadSchema = z.object({ id: ExtensionIdSchema, key: z.string().min(1).max(256) });
// A key never written or deleted has no value, which JSON sends as no field at all.
export const ExtensionStorageGetResultSchema = z.object({ value: z.unknown().optional() });
export const ExtensionStorageSetPayloadSchema = z.object({ id: ExtensionIdSchema, key: z.string().min(1).max(256), value: z.unknown().optional() });

/* A key a client, another window or the extension's `server/` wrote, to every client, so a surface that reads it never keeps an older value. */
export const ExtensionStorageChangedEventSchema = z.object({ id: ExtensionIdSchema, key: z.string().min(1).max(256), value: z.unknown().optional() });
export type ExtensionStorageChangedEvent = z.infer<typeof ExtensionStorageChangedEventSchema>;

/* A prompt whose answer comes in pieces, as `extension.agentChunk` for this client's own run id. It answers once the run is over. */
export const ExtensionAgentStreamPayloadSchema = z.object({
    runId: z.string().min(1).max(64),
    prompt: z.string().min(1),
    provider: z.string().optional(),
    projectId: z.string().min(1)
});
export const ExtensionAgentStopPayloadSchema = z.object({ runId: z.string().min(1).max(64) });
export const ExtensionAgentChunkEventSchema = z.object({ runId: z.string(), text: z.string() });

/* A chat a person sees: on the canvas it names, or a view of its own in the sidebar without one. */
export const ExtensionAgentStartPayloadSchema = z.object({
    id: ExtensionIdSchema,
    projectId: z.string().min(1),
    viewId: z.string().min(1).optional(),
    beside: z.string().min(1).optional(),
    provider: z.string().optional(),
    title: z.string().max(200).optional(),
    prompt: z.string().optional(),
    // The folder of another project on the machine to start the chat in, instead of `projectId`.
    folder: z.string().min(1).optional(),
    // A chat the extension draws itself: kept in the project as a chat view the sidebar leaves out (`drawnBy`).
    hidden: z.boolean().optional()
});
export const ExtensionAgentStartResultSchema = z.object({ nodeId: z.string() });

/* An action of the machine, by name, within what `EXTENSION_ACTIONS` lets an extension ask for. */
export const ExtensionActionPayloadSchema = z.object({ id: ExtensionIdSchema, projectId: z.string().min(1), action: z.string().min(1), input: z.unknown() });
export const ExtensionActionResultSchema = z.object({ output: z.unknown() });

/* What a client without a shell of its own loads, from the machine. */
export const ExtensionClientFilesResultSchema = z.object({ hash: z.string(), files: z.record(z.string(), z.string()) });

/* One read-only statement, as an agent may run it. */
export const ExtensionDatabaseQueryPayloadSchema = z.object({ projectId: z.string().min(1), connection: z.string().min(1), sql: z.string().min(1) });
/*
 * A cell as the database gave it; a large number, a decimal or a date is the text the server writes for it, and a long
 * text arrives cut off. The wire leaves a cell open, so a kind of cell a newer machine sends never fails the whole reply.
 */
export type ExtensionDatabaseValue =
    | string
    | number
    | boolean
    | null
    // `length` only for bytes whose hex is cut off.
    | { kind: 'binary'; hex: string; length?: number }
    | { kind: 'longText'; preview: string; length: number };
export const ExtensionDatabaseQueryResultSchema = z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.unknown())), hasMore: z.boolean() });

/* One line for the terminal of `ruimte extension dev`. */
export const ExtensionLogPayloadSchema = z.object({ id: ExtensionIdSchema, text: z.string().max(16_000) });

export const ExtensionMessageEventSchema = z.object({
    id: ExtensionIdSchema,
    name: z.string().min(1).max(120),
    // `emit(name)` without a payload sends none over JSON.
    payload: z.unknown().optional()
});
export type ExtensionMessageEvent = z.infer<typeof ExtensionMessageEventSchema>;

export const ExtensionContextReadPayloadSchema = z.object({
    projectId: z.string().min(1),
    nodeIds: z.array(z.string().min(1)).max(100).optional(),
    viewId: z.string().min(1).optional(),
    // Only nodes of this kind, checked before anything is read: `terminals.read` must never read a chat.
    kind: z.string().min(1).optional()
});
export type ExtensionContextReadPayload = z.infer<typeof ExtensionContextReadPayloadSchema>;

export const ExtensionContextReadResultSchema = z.object({
    sources: z.array(z.object({ id: z.string(), kind: z.string(), title: z.string(), text: z.string() }))
});
export type ExtensionContextReadResult = z.infer<typeof ExtensionContextReadResultSchema>;

/* A chat as `chats.read` in `server/` reads it, also one in a view of its own. */
export const ExtensionChatReadPayloadSchema = z.object({ chatId: z.string().min(1) });
export type ExtensionChatReadPayload = z.infer<typeof ExtensionChatReadPayloadSchema>;

export const ExtensionChatReadResultSchema = z.object({ text: z.string() });
export type ExtensionChatReadResult = z.infer<typeof ExtensionChatReadResultSchema>;

export const ExtensionAgentRunPayloadSchema = z.object({
    prompt: z.string().min(1),
    projectId: z.string().min(1),
    provider: z.string().min(1).optional()
});
export type ExtensionAgentRunPayload = z.infer<typeof ExtensionAgentRunPayloadSchema>;

export const ExtensionAgentRunResultSchema = z.object({ text: z.string() });
export type ExtensionAgentRunResult = z.infer<typeof ExtensionAgentRunResultSchema>;

export const EXTENSION_REQUEST_SCHEMAS = {
    'extension.contextRead': { payload: ExtensionContextReadPayloadSchema, result: ExtensionContextReadResultSchema },
    'extension.chatRead': { payload: ExtensionChatReadPayloadSchema, result: ExtensionChatReadResultSchema },
    'extension.agentRun': { payload: ExtensionAgentRunPayloadSchema, result: ExtensionAgentRunResultSchema },
    'extension.list': { payload: EmptySchema, result: ExtensionListResultSchema },
    'extension.install': { payload: ExtensionInstallPayloadSchema, result: ExtensionInfoSchema },
    'extension.remove': { payload: ExtensionIdPayloadSchema, result: EmptySchema },
    'extension.setEnabled': { payload: ExtensionSetEnabledPayloadSchema, result: EmptySchema },
    'extension.storageGet': { payload: ExtensionStorageGetPayloadSchema, result: ExtensionStorageGetResultSchema },
    'extension.storageSet': { payload: ExtensionStorageSetPayloadSchema, result: EmptySchema },
    'extension.agentStream': { payload: ExtensionAgentStreamPayloadSchema, result: EmptySchema },
    'extension.agentStart': { payload: ExtensionAgentStartPayloadSchema, result: ExtensionAgentStartResultSchema },
    'extension.agentStop': { payload: ExtensionAgentStopPayloadSchema, result: EmptySchema },
    'extension.databaseQuery': { payload: ExtensionDatabaseQueryPayloadSchema, result: ExtensionDatabaseQueryResultSchema },
    'extension.action': { payload: ExtensionActionPayloadSchema, result: ExtensionActionResultSchema },
    'extension.clientFiles': { payload: ExtensionIdPayloadSchema, result: ExtensionClientFilesResultSchema },
    'extension.log': { payload: ExtensionLogPayloadSchema, result: EmptySchema },
    'extension.call': { payload: ExtensionCallPayloadSchema, result: ExtensionCallResultSchema }
} as const;

export const EXTENSION_EVENT_SCHEMAS = {
    'extension.changed': EmptySchema,
    'extension.message': ExtensionMessageEventSchema,
    'extension.agentChunk': ExtensionAgentChunkEventSchema,
    'extension.storageChanged': ExtensionStorageChangedEventSchema
} as const;
