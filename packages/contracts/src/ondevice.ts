import { z } from 'zod';

/*
 * One-shot generations on the machine's own model (Apple Foundation Models), for the editor's short help:
 * an explanation, names for a symbol, a continuation at the caret. The daemon runs them in a helper process
 * that has no tools and no network, so the code a client sends never leaves the machine. Each purpose has
 * its instructions on the daemon; the client sends only the text the model reads.
 */
export const OnDevicePurposeSchema = z.enum(['explain', 'names', 'ghost']);
export type OnDevicePurpose = z.infer<typeof OnDevicePurposeSchema>;

/* The most text a prompt may carry, which is also what fits the model's context beside its instructions and answer. */
export const ONDEVICE_PROMPT_MAX = 12_000;

export const OnDeviceStatusResultSchema = z.object({
    available: z.boolean(),
    // Why the model is not there: not this kind of machine, Apple Intelligence off, a model that is still downloading.
    reason: z.string().optional()
});
export type OnDeviceStatusResult = z.infer<typeof OnDeviceStatusResultSchema>;

export const OnDeviceGeneratePayloadSchema = z.object({
    // Chosen by the client, which is what `ondevice.cancel` and `ondevice.text` name.
    id: z.string().min(1).max(80),
    purpose: OnDevicePurposeSchema,
    prompt: z.string().min(1).max(ONDEVICE_PROMPT_MAX),
    // Send `ondevice.text` with the text so far as it grows.
    stream: z.boolean().optional()
});
export type OnDeviceGeneratePayload = z.infer<typeof OnDeviceGeneratePayloadSchema>;

/* `aborted` when a cancel got there first; a failure answers as an error with a code instead. */
export const OnDeviceGenerateResultSchema = z.object({
    state: z.enum(['done', 'aborted']),
    text: z.string()
});
export type OnDeviceGenerateResult = z.infer<typeof OnDeviceGenerateResultSchema>;

export const OnDeviceCancelPayloadSchema = z.object({ id: z.string().min(1).max(80) });

/* To the client that asked, the whole text so far each time. */
export const OnDeviceTextEventSchema = z.object({ id: z.string(), text: z.string() });
export type OnDeviceTextEvent = z.infer<typeof OnDeviceTextEventSchema>;

export const ONDEVICE_ERROR_CODES = ['unavailable', 'failed', 'busy'] as const;
