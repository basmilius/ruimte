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
    themes: z.array(z.string().min(1)).optional()
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
    'extension.log': { payload: ExtensionLogPayloadSchema, result: EmptySchema },
    'extension.call': { payload: ExtensionCallPayloadSchema, result: ExtensionCallResultSchema }
} as const;

export const EXTENSION_EVENT_SCHEMAS = {
    'extension.changed': EmptySchema,
    'extension.message': ExtensionMessageEventSchema
} as const;
