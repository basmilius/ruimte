import { z } from 'zod';

export const ServerHelloPayloadSchema = z.object({});
export type ServerHelloPayload = z.infer<typeof ServerHelloPayloadSchema>;

export const ServerHelloResultSchema = z.object({
    version: z.string(),
    platform: z.string(),
    home: z.string()
});
export type ServerHelloResult = z.infer<typeof ServerHelloResultSchema>;

export const ServerPingPayloadSchema = z.object({});
export type ServerPingPayload = z.infer<typeof ServerPingPayloadSchema>;

// The daemon's own clock in epoch milliseconds; the client times the round trip itself.
export const ServerPingResultSchema = z.object({
    time: z.number()
});
export type ServerPingResult = z.infer<typeof ServerPingResultSchema>;
