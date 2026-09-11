import { z } from 'zod';

export const ServerHelloPayloadSchema = z.object({});
export type ServerHelloPayload = z.infer<typeof ServerHelloPayloadSchema>;

export const ServerHelloResultSchema = z.object({
    version: z.string(),
    platform: z.string(),
    home: z.string(),
    // What the hardware is called ("MacBook Pro", "XPS 15 9500"), read once when the daemon started.
    // Absent when the machine keeps that to itself, and the client says "This machine" then.
    model: z.string().optional()
});
export type ServerHelloResult = z.infer<typeof ServerHelloResultSchema>;

export const ServerPingPayloadSchema = z.object({});
export type ServerPingPayload = z.infer<typeof ServerPingPayloadSchema>;

// The daemon's own clock in epoch milliseconds; the client times the round trip itself.
export const ServerPingResultSchema = z.object({
    time: z.number()
});
export type ServerPingResult = z.infer<typeof ServerPingResultSchema>;
