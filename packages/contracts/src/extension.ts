import { z } from 'zod';
import { EmptySchema } from '@adecore/agent-contracts';

/* What a person's Ruimte promises an extension. It moves only when an extension built for the old one stops working. */
export const EXTENSION_API_VERSION = 1;

export const ExtensionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/);

/* Where a pack keeps its mark, the same for every extension, so a list needs no word from its code. */
export const EXTENSION_ICON_PATH = 'assets/icon.svg';

/* The permission each action of the machine needs. What is not here an extension cannot name. */
export const EXTENSION_ACTIONS: Readonly<Record<string, string>> = {
    'launch.list': 'launches.read',
    'launch.read': 'launches.read',
    'launch.start': 'launches.run',
    'launch.restart': 'launches.run',
    'launch.stop': 'launches.run',
    'routine.list': 'routines.read',
    'routine.run': 'routines.run',
    'routine.pause': 'routines.run',
    'routine.resume': 'routines.run',
    'artifact.list': 'artifacts.read',
    'artifact.read': 'artifacts.read',
    'artifact.publish': 'artifacts.write',
    'browser.inspect': 'browser.control',
    'browser.navigate': 'browser.control',
    'browser.back': 'browser.control',
    'browser.forward': 'browser.control',
    'browser.reload': 'browser.control',
    'browser.screenshot': 'browser.control',
    'device.list': 'devices.control',
    'device.inspect': 'devices.control',
    'device.screenshot': 'devices.control',
    'device.tap': 'devices.control',
    'device.launch': 'devices.control'
};

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

/* A theme is data, read before any extension code runs. Tokens override the base of one side. */
export const ExtensionThemeSchema = z.object({
    name: z.string().min(1).max(80),
    side: z.enum(['light', 'dark']),
    tokens: z.record(z.string().regex(/^--[a-z0-9-]+$/), z.string().regex(/^[^;{}]+$/)),
    css: z.string().min(1).optional()
});
export type ExtensionTheme = z.infer<typeof ExtensionThemeSchema>;

/* A theme's stylesheet reads only from its own pack, so a theme never phones home. */
export function extensionThemeCssProblem(css: string): string | null {
    if (/@import/i.test(css)) {
        return '@import is not allowed';
    }

    for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
        const target = match[2] ?? '';

        if (/^([a-z][a-z0-9+.-]*:|\/|\.\.)/i.test(target) || target.includes('/../')) {
            return `url(${target}) points outside the pack`;
        }
    }

    return null;
}

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
    revision: z.number().int().nonnegative().optional()
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
export const ExtensionStorageGetResultSchema = z.object({ value: z.unknown() });
export const ExtensionStorageSetPayloadSchema = z.object({ id: ExtensionIdSchema, key: z.string().min(1).max(256), value: z.unknown() });

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
    prompt: z.string().optional()
});
export const ExtensionAgentStartResultSchema = z.object({ nodeId: z.string() });

/* An action of the machine, by name, within what `EXTENSION_ACTIONS` lets an extension ask for. */
export const ExtensionActionPayloadSchema = z.object({ id: ExtensionIdSchema, projectId: z.string().min(1), action: z.string().min(1), input: z.unknown() });
export const ExtensionActionResultSchema = z.object({ output: z.unknown() });

/* What a client without a shell of its own loads, from the machine. */
export const ExtensionClientFilesResultSchema = z.object({ hash: z.string(), files: z.record(z.string(), z.string()) });

/* One read-only statement, as an agent may run it. */
export const ExtensionDatabaseQueryPayloadSchema = z.object({ projectId: z.string().min(1), connection: z.string().min(1), sql: z.string().min(1) });
export const ExtensionDatabaseQueryResultSchema = z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.unknown())), hasMore: z.boolean() });

/* One line for the terminal of `ruimte extension dev`. */
export const ExtensionLogPayloadSchema = z.object({ id: ExtensionIdSchema, text: z.string().max(16_000) });

export const ExtensionMessageEventSchema = z.object({
    id: ExtensionIdSchema,
    name: z.string().min(1).max(120),
    payload: z.unknown()
});
export type ExtensionMessageEvent = z.infer<typeof ExtensionMessageEventSchema>;

export const ExtensionContextReadPayloadSchema = z.object({
    projectId: z.string().min(1),
    nodeIds: z.array(z.string().min(1)).max(100).optional(),
    viewId: z.string().min(1).optional()
});
export type ExtensionContextReadPayload = z.infer<typeof ExtensionContextReadPayloadSchema>;

export const ExtensionContextReadResultSchema = z.object({
    sources: z.array(z.object({ id: z.string(), kind: z.string(), title: z.string(), text: z.string() }))
});
export type ExtensionContextReadResult = z.infer<typeof ExtensionContextReadResultSchema>;

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
    'extension.agentChunk': ExtensionAgentChunkEventSchema
} as const;
