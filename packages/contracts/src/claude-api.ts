import { z } from 'zod';
import { NanoGptSettingsSchema } from './nanogpt.ts';

/*
 * How a chat on the API of Claude behaves, which a person decides per machine: the cut of a run of tool rounds
 * a NanoGPT chat has, and `maxOutputTokens`, the `max_tokens` of every request, which the API requires and the model caps.
 */
export const ClaudeApiSettingsSchema = NanoGptSettingsSchema.extend({
    maxOutputTokens: z.number().int().min(1024).max(128_000),
    // The context window a new chat starts on, for a model that offers both; absent is `200k`.
    contextWindow: z.enum(['200k', '1m']).optional()
});
export type ClaudeApiSettings = z.infer<typeof ClaudeApiSettingsSchema>;

/*
 * Unlike a subscription, every call here is paid for, so a chat does not go on by itself unless a person turned that on.
 * Thinking counts toward `max_tokens` and a request is billed for what it used, so the default leaves room for a long reply.
 * A long context costs more per token past 200k, so a new chat starts on 200k.
 */
export const DEFAULT_CLAUDE_API_SETTINGS: ClaudeApiSettings = {
    autoContinue: false,
    roundsPerRun: 40,
    runs: 3,
    maxOutputTokens: 32_000,
    contextWindow: '200k'
};

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
