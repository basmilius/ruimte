import { z } from 'zod';

// The client picks the id (its node id), so the only rule is that it is not empty.
export const SessionIdSchema = z.string().min(1);
export type SessionId = z.infer<typeof SessionIdSchema>;
