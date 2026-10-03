import { z } from 'zod';
import { MachineWorkSchema } from './machine-http.ts';

/*
 * Where the updater of the desktop app on a machine stands, in its own words. Open on the iPhone: a
 * newer app may grow a step, and a phone that refused the whole `endpoint.info` over it would lose the machine.
 */
export const MachineUpdateStatusSchema = z.enum(['unsupported', 'idle', 'checking', 'current', 'available', 'downloading', 'ready', 'error']);
export type MachineUpdateStatus = z.infer<typeof MachineUpdateStatusSchema>;

/* What the desktop app on the machine knows of its next version. */
export const MachineUpdateReportSchema = z.object({
    status: MachineUpdateStatusSchema,
    // The version of the app, which may differ from the daemon's `version` for a moment around an update.
    currentVersion: z.string().max(64).optional(),
    version: z.string().max(64).optional(),
    percent: z.number().min(0).max(100).optional(),
    error: z.string().max(1000).nullish()
});
export type MachineUpdateReport = z.infer<typeof MachineUpdateReportSchema>;

/*
 * The update of a machine as every client sees it. The daemon itself cannot update: only the desktop
 * app installs a release, so without it connected (a daemon from npm, the service while the app is
 * closed) `app` is false and the update has to be done on the computer itself.
 */
export const MachineUpdateSchema = MachineUpdateReportSchema.extend({
    app: z.boolean()
});
export type MachineUpdate = z.infer<typeof MachineUpdateSchema>;

// The update changed: a step, the download moving on a whole percent, or the app coming or going.
export const EndpointUpdateChangedEventSchema = z.object({ update: MachineUpdateSchema });
export type EndpointUpdateChangedEvent = z.infer<typeof EndpointUpdateChangedEventSchema>;

/*
 * `endpoint.installUpdate`: installing restarts the app, and without the background service that ends
 * every terminal and agent on the machine. So the first ask leaves `confirm` false and only learns what
 * would end; the install itself is a second, explicit ask with `confirm` true.
 */
export const EndpointInstallUpdatePayloadSchema = z.object({ confirm: z.boolean() });
export type EndpointInstallUpdatePayload = z.infer<typeof EndpointInstallUpdatePayloadSchema>;

export const EndpointInstallUpdateResultSchema = z.object({
    // True once the app on the machine was asked to install; it downloads first when it has not yet.
    started: z.boolean(),
    // What the restart cuts short right now; zero when the daemon runs as the service and outlives the app.
    ending: MachineWorkSchema
});
export type EndpointInstallUpdateResult = z.infer<typeof EndpointInstallUpdateResultSchema>;
