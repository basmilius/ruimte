import { z } from 'zod';

/*
 * The socket protocol of the computer use helper (`apps/computer-use`, `Wire.swift`). It never leaves
 * this machine and no client sees it, so it lives beside the daemon's side of it and not in contracts.
 * The reply schemas keep only what the daemon reads; a field the helper adds later passes unseen.
 */

export const HELPER_COMMANDS = ['doctor', 'apps', 'quit', 'state', 'click', 'scroll', 'type', 'key', 'set-value', 'open', 'menu'] as const;
export type HelperCommand = (typeof HELPER_COMMANDS)[number];

/* The commands that read or operate one app, which is what a person has to let an agent into. */
export const APP_COMMANDS = ['state', 'click', 'scroll', 'type', 'key', 'set-value', 'open', 'menu'] as const;
export type AppCommand = (typeof APP_COMMANDS)[number];

/* How the tree and the picture of a `state` are cut, for `state` itself and every action with `withState`. */
export interface StateOptions {
    maxDepth?: number;
    maxElements?: number;
    maxText?: number;
    screenshot?: boolean;
}

export interface HelperRequest extends StateOptions {
    command: HelperCommand;
    // The content of `$RUIMTE_HOME/local.key`; the transport puts it on, so nothing above it holds the secret.
    secret?: string;
    // A pid for an app that runs, a bundle id for one `open` launches: never a name, so the helper acts on the app a person let in.
    app?: string;
    element?: number;
    x?: number;
    y?: number;
    count?: number;
    text?: string;
    value?: string;
    combos?: string[];
    prompt?: boolean;
    button?: string;
    direction?: string;
    pages?: number;
    path?: string;
    withState?: boolean;
}

export const HelperReplySchema = z.union([
    z.object({ ok: z.literal(true), result: z.record(z.string(), z.unknown()) }),
    z.object({ ok: z.literal(false), error: z.string() })
]);

export const DoctorResultSchema = z.object({
    accessibility: z.object({ granted: z.boolean() }),
    screenRecording: z.object({ granted: z.boolean() }),
    ready: z.boolean()
});
export type DoctorResult = z.infer<typeof DoctorResultSchema>;

export const RunningAppSchema = z.object({
    name: z.string(),
    pid: z.number().int(),
    bundleId: z.string().optional(),
    frontmost: z.boolean().optional(),
    hidden: z.boolean().optional()
});
export type RunningApp = z.infer<typeof RunningAppSchema>;

export const AppsResultSchema = z.object({ apps: z.array(RunningAppSchema) });

const AppDescriptorSchema = z.object({ name: z.string(), pid: z.number().int(), bundleId: z.string().optional() });

export const StateResultSchema = z.object({
    app: AppDescriptorSchema,
    window: z.object({
        title: z.string(),
        frame: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
        sheet: z.string().optional()
    }),
    screenshot: z.object({
        path: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        scale: z.number().optional(),
        origin: z.object({ x: z.number(), y: z.number() }).optional(),
        error: z.string().optional()
    }),
    elements: z.number().int(),
    tree: z.array(z.string()),
    truncated: z.string().optional(),
    hidden: z.boolean().optional(),
    note: z.string().optional()
});
export type StateResult = z.infer<typeof StateResultSchema>;

export const TargetSchema = z.object({
    role: z.string().optional(),
    label: z.string().optional(),
    identifier: z.string().optional(),
    window: z.string().optional(),
    sheet: z.string().optional()
});

/*
 * What an action answers. Besides these, each command reports a few scalars of its own (`method`,
 * `typed`, `pressed`, `menu`, `launched`, ...), kept as they came in `details`.
 */
export const ActionResultSchema = z
    .object({
        app: AppDescriptorSchema.optional(),
        target: TargetSchema.optional(),
        point: z.object({ x: z.number(), y: z.number() }).optional(),
        settled: z.boolean().optional(),
        state: z.union([StateResultSchema, z.object({ error: z.string() })]).optional(),
        // A menu listing; a string only when an item was run, which is the path it ran.
        menu: z.union([z.array(z.string()), z.string()]).optional(),
        truncated: z.string().optional(),
        note: z.string().optional()
    })
    .catchall(z.unknown());
export type ActionResult = z.infer<typeof ActionResultSchema>;
