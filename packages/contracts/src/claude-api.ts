import { z } from 'zod';

/*
 * How a chat on the API of Claude behaves, which a person decides per machine. A run of tool rounds is cut at
 * `roundsPerRun` so a loop that never ends cannot spend money; with `autoContinue` the chat goes on by itself for
 * up to `runs` runs, and without it the first cut stops it and waits for a message. `maxOutputTokens` is the
 * `max_tokens` of every request, which the API requires, and is capped by what the model allows.
 */
export const ClaudeApiSettingsSchema = z.object({
    autoContinue: z.boolean(),
    roundsPerRun: z.number().int().min(5).max(200),
    runs: z.number().int().min(1).max(20),
    maxOutputTokens: z.number().int().min(1024).max(128_000)
});
export type ClaudeApiSettings = z.infer<typeof ClaudeApiSettingsSchema>;

/* Unlike a subscription, every call here is paid for, so a chat does not go on by itself unless a person turned that on. */
export const DEFAULT_CLAUDE_API_SETTINGS: ClaudeApiSettings = { autoContinue: false, roundsPerRun: 40, runs: 3, maxOutputTokens: 8192 };

/* Whether this machine holds a key for the API of Claude, and how many models it offers. Never the key. */
export const ClaudeApiStatusSchema = z.object({
    configured: z.boolean(),
    models: z.number().int().nonnegative(),
    settings: ClaudeApiSettingsSchema.optional()
});
export type ClaudeApiStatus = z.infer<typeof ClaudeApiStatusSchema>;

export const ClaudeApiConfigurePayloadSchema = z.object({
    // An empty key disconnects; leaving it out fetches the models again with the saved key.
    apiKey: z.string().trim().max(4096).optional(),
    // Only the settings, when this is all there is: nothing is fetched and the key stays as it is.
    settings: ClaudeApiSettingsSchema.partial().optional()
});
export type ClaudeApiConfigurePayload = z.infer<typeof ClaudeApiConfigurePayloadSchema>;
