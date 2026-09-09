import { z } from 'zod';

export const ServerHelloPayloadSchema = z.object({});
export type ServerHelloPayload = z.infer<typeof ServerHelloPayloadSchema>;

export const ServerHelloResultSchema = z.object({
    version: z.string(),
    platform: z.string(),
    home: z.string()
});
export type ServerHelloResult = z.infer<typeof ServerHelloResultSchema>;
