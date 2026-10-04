import { z } from 'zod';

/* The machine's door on the local network: its port and the addresses of the interfaces it listens on. */
export const LanDoorSchema = z.object({
    port: z.number().int().min(1).max(65_535),
    addresses: z.array(z.string().min(1).max(64)).max(16)
});
export type LanDoor = z.infer<typeof LanDoorSchema>;
