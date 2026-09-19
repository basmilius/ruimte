import { z } from 'zod';

/*
 * How many samples a subscriber holds. An agreement rather than a preference: it is how long a plot
 * goes back and how much of it travels on `processes.subscribe`, so the daemon and a client that
 * stays subscribed for a day have to cut at the same point. Ten minutes at two seconds, a day at
 * five minutes.
 */
export const FINE_POINTS = 300;
export const COARSE_POINTS = 288;

/* What the panel lists: the processes Ruimte started, or every process on the machine. */
export const ProcessScopeSchema = z.enum(['ruimte', 'all']);
export type ProcessScope = z.infer<typeof ProcessScopeSchema>;

export const ProcessSortSchema = z.enum(['cpu', 'memory', 'disk']);
export type ProcessSort = z.infer<typeof ProcessSortSchema>;

export const ProcessRowSchema = z.object({
    pid: z.number().int(),
    /* Microseconds since the epoch. With the pid it names one process, since a pid is reused. */
    startTime: z.number(),
    ppid: z.number().int(),
    name: z.string(),
    path: z.string().nullable(),
    /* False when the kernel refused the counters; the numbers are null then, which is not zero. */
    readable: z.boolean(),
    /* Percent of one core, averaged since the sample before. Null on the first sight of a process. */
    cpu: z.number().nullable(),
    /* The footprint in bytes: what the machine charges the process, compressed memory included. */
    memory: z.number().nullable(),
    /* Bytes per second. */
    diskRead: z.number().nullable(),
    diskWrite: z.number().nullable(),
    /* The AI CLI the process is or runs under (`claude`, `codex`, ...), inherited from its ancestors. */
    family: z.string().nullable(),
    /* How deep under the root of its group, so a row can indent. */
    depth: z.number().int().nonnegative()
});
export type ProcessRow = z.infer<typeof ProcessRowSchema>;

/* A terminal or chat node, the desktop app around the daemon, the daemon with its own tasks, or everything else. */
export const ProcessGroupKindSchema = z.enum(['terminal', 'chat', 'app', 'daemon', 'other']);
export type ProcessGroupKind = z.infer<typeof ProcessGroupKindSchema>;

export const ProcessGroupSchema = z.object({
    id: z.string(),
    kind: ProcessGroupKindSchema,
    /* The session or chat id, which is the node id; the client knows the node's title and project. */
    nodeId: z.string().nullable(),
    /* Sums over the readable processes; null when not one of them could be read. */
    cpu: z.number().nullable(),
    memory: z.number().nullable(),
    diskRead: z.number().nullable(),
    diskWrite: z.number().nullable(),
    processes: z.array(ProcessRowSchema),
    /* Processes of the group left out of `processes`, which only the `other` group does. */
    hidden: z.number().int().nonnegative()
});
export type ProcessGroup = z.infer<typeof ProcessGroupSchema>;

export const ProcessMachineSchema = z.object({
    cores: z.number().int().positive(),
    /* Percent of all cores together. */
    cpu: z.number().nullable(),
    memoryUsed: z.number().nullable(),
    memoryTotal: z.number(),
    /* The sum of every readable process: a system counter would need IOKit on macOS. */
    diskRead: z.number().nullable(),
    diskWrite: z.number().nullable(),
    /* Of the volume the daemon's home is on. */
    diskFree: z.number().nullable(),
    diskTotal: z.number().nullable()
});
export type ProcessMachine = z.infer<typeof ProcessMachineSchema>;

/* One point of the three charts: the machine as a line, the share of Ruimte as the area under it. */
export const ProcessPointSchema = z.object({
    at: z.number(),
    /* Percent of all cores. */
    cpu: z.number().nullable(),
    cpuRuimte: z.number().nullable(),
    memory: z.number().nullable(),
    memoryRuimte: z.number().nullable(),
    /* Bytes per second, read and written together. */
    disk: z.number().nullable(),
    diskRuimte: z.number().nullable()
});
export type ProcessPoint = z.infer<typeof ProcessPointSchema>;

export const ProcessAlertKindSchema = z.enum(['silent', 'busy-after-turn', 'memory', 'agent-gone', 'orphan', 'probe-hung']);
export type ProcessAlertKind = z.infer<typeof ProcessAlertKindSchema>;

export const ProcessAlertSchema = z.object({
    id: z.string(),
    kind: ProcessAlertKindSchema,
    nodeId: z.string().nullable(),
    /* The process the button acts on, when there is one. */
    pid: z.number().int().nullable(),
    startTime: z.number().nullable(),
    name: z.string().nullable(),
    /* When the stretch the warning is about began: the last hook event, the start of a process. */
    since: z.number(),
    /* What was measured: percent of one core, bytes, or nothing. */
    value: z.number().nullable()
});
export type ProcessAlert = z.infer<typeof ProcessAlertSchema>;

export const ProcessesSubscribePayloadSchema = z.object({ scope: ProcessScopeSchema, sort: ProcessSortSchema });
export type ProcessesSubscribePayload = z.infer<typeof ProcessesSubscribePayloadSchema>;

export const ProcessesSampleEventSchema = z.object({
    at: z.number(),
    scope: ProcessScopeSchema,
    machine: ProcessMachineSchema,
    groups: z.array(ProcessGroupSchema),
    /* The point this sample added to the fine or the coarse series, if it added one. */
    fine: ProcessPointSchema.nullable(),
    coarse: ProcessPointSchema.nullable(),
    /* The machine slept since the sample before, so both series started over. */
    reset: z.boolean()
});
export type ProcessesSampleEvent = z.infer<typeof ProcessesSampleEventSchema>;

export const ProcessesSubscribeResultSchema = z.object({
    /* False on a platform without a sampler; nothing else in the answer means anything then. */
    supported: z.boolean(),
    fineIntervalMs: z.number().int().positive(),
    coarseIntervalMs: z.number().int().positive(),
    /* Every two seconds while a panel on this machine is open, the last ten minutes. */
    fine: z.array(ProcessPointSchema),
    /* Every five minutes, the last day. */
    coarse: z.array(ProcessPointSchema),
    sample: ProcessesSampleEventSchema.nullable()
});
export type ProcessesSubscribeResult = z.infer<typeof ProcessesSubscribeResultSchema>;

export const ProcessSignalSchema = z.enum(['SIGINT', 'SIGTERM', 'SIGKILL']);
export type ProcessSignal = z.infer<typeof ProcessSignalSchema>;

export const ProcessesSignalPayloadSchema = z.object({
    pid: z.number().int().positive(),
    /* Checked again before the signal, so a pid that now names another process is refused. */
    startTime: z.number(),
    signal: ProcessSignalSchema
});
export type ProcessesSignalPayload = z.infer<typeof ProcessesSignalPayloadSchema>;

export const ProcessesAlertsSchema = z.object({ alerts: z.array(ProcessAlertSchema) });
export type ProcessesAlerts = z.infer<typeof ProcessesAlertsSchema>;

export const ProcessesDismissPayloadSchema = z.object({ id: z.string() });
export type ProcessesDismissPayload = z.infer<typeof ProcessesDismissPayloadSchema>;
