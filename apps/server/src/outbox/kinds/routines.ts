import { z } from 'zod';
import { defineOutboxKind } from '../kind.ts';

const RoutineRunSchema = z.object({
    kind: z.literal('routine-run'),
    // The target is `routine:<projectId>:<routineId>`; `due` is the time it is owed for, which `notBefore` holds too.
    payload: z.object({ routineId: z.string().min(1), due: z.number().int().nonnegative() })
});

/* Owed to a routine, which has no node for a target. */
export const routineRunKind = defineOutboxKind(RoutineRunSchema, { outlivesTarget: true });

const EndRunProcessSchema = z.object({
    kind: z.literal('end-run-process'),
    // The target is the run's chat, so nothing opens a turn in it while its CLI ends.
    payload: z.object({ runId: z.string().min(1) })
});

/* Owed to the chat of an agent run that ended: its CLI has no turn left to take, and no canvas shows the chat for a person to close. */
export const endRunProcessKind = defineOutboxKind(EndRunProcessSchema, { outlivesTarget: true });
