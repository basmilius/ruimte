import { z } from 'zod';

/*
 * How a NanoGPT chat behaves, which a person decides per machine. A run of tool rounds is cut at
 * `roundsPerRun` so a loop that never ends cannot spend the subscription; with `autoContinue` the chat
 * goes on by itself for up to `runs` runs, and without it the first cut stops it and waits for a message.
 */
export const NanoGptSettingsSchema = z.object({
    autoContinue: z.boolean(),
    roundsPerRun: z.number().int().min(5).max(200),
    runs: z.number().int().min(1).max(20)
});
export type NanoGptSettings = z.infer<typeof NanoGptSettingsSchema>;

export const DEFAULT_NANOGPT_SETTINGS: NanoGptSettings = { autoContinue: true, roundsPerRun: 40, runs: 5 };

/* Whether this machine holds a NanoGPT subscription key, and how many included models it offers. Never the key. */
export const NanoGptStatusSchema = z.object({
    configured: z.boolean(),
    models: z.number().int().nonnegative(),
    // Absent from a machine from before there were any.
    settings: NanoGptSettingsSchema.optional()
});
export type NanoGptStatus = z.infer<typeof NanoGptStatusSchema>;

export const NanoGptConfigurePayloadSchema = z.object({
    // An empty key disconnects; leaving it out fetches the included models again with the saved key.
    apiKey: z.string().trim().max(4096).optional(),
    // Only the settings, when this is all there is: nothing is fetched and the key stays as it is.
    settings: NanoGptSettingsSchema.partial().optional()
});
export type NanoGptConfigurePayload = z.infer<typeof NanoGptConfigurePayloadSchema>;
