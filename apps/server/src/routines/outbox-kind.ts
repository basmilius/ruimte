import { z } from 'zod';
import { defineOutboxKind } from '../outbox/kind.ts';

const RoutineRunSchema = z.object({
    kind: z.literal('routine-run'),
    // The target is `routine:<projectId>:<routineId>`; `due` is the time it is owed for, which `notBefore` holds too.
    payload: z.object({ routineId: z.string().min(1), due: z.number().int().nonnegative() })
});

/* Owed to a routine, which has no node for a target. */
export const routineRunKind = defineOutboxKind(RoutineRunSchema, { outlivesTarget: true });
