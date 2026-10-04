import { z } from 'zod';

/* When the machine keeps itself from sleeping: never, while an agent works, or always. */
export const KeepAwakeModeSchema = z.enum(['off', 'working', 'always']);
export type KeepAwakeMode = z.infer<typeof KeepAwakeModeSchema>;

/* On battery, the closed-lid mode lets go below this charge, in percent. */
export const CLOSED_LID_BATTERY_FLOOR = 20;
