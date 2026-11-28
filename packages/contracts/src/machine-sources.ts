import { EmptySchema } from '@adecore/agent-contracts/protocol';
import { RegisterMachinePayloadSchema } from '@ruimte/pulsar';
import { z } from 'zod';
import { ProjectIdSchema } from './project.ts';

/* The most lines of a start a client is told, the newest kept, and the most characters of one. */
export const MACHINE_START_LINES = 200;
export const MACHINE_START_LINE_LENGTH = 500;

/* Which source of which extension lists a place, and what a person calls that source. */
export const MachineSourceRefSchema = z.object({
    extension: z.string().min(1),
    id: z.string().min(1),
    title: z.string().min(1)
});
export type MachineSourceRef = z.infer<typeof MachineSourceRefSchema>;

/*
 * Where a start stands. `preparing` asks the source what to run, `held` waits for a person's yes to that, `starting`
 * runs it, and `joining` has the new machine sign itself onto the account and waits for a client to post that.
 */
export const MachineStartStateSchema = z.enum(['idle', 'preparing', 'held', 'starting', 'joining', 'done', 'failed', 'stopped']);
export type MachineStartState = z.infer<typeof MachineStartStateSchema>;

/* One program a start runs on this machine, as a person reads it before saying yes. */
export const MachineStartProgramSchema = z.object({
    // What the source calls the step; absent for the one that has the new machine join the account.
    title: z.string().optional(),
    // As a shell would read it, though no shell does.
    command: z.string(),
    // Absolute, where it runs.
    cwd: z.string(),
    env: z.record(z.string(), z.string()).optional(),
    // Runs `ruimte join` in the place the machine lives, for the account this machine is on: the yes to it puts the new machine there.
    join: z.boolean().optional()
});
export type MachineStartProgram = z.infer<typeof MachineStartProgramSchema>;

/* What waits on a person's approval before this machine runs it. `digest` names it, so a yes covers what was read and nothing newer. */
export const MachineStartHeldSchema = z.object({
    digest: z.string().min(1),
    // In the order they run.
    programs: z.array(MachineStartProgramSchema)
});
export type MachineStartHeld = z.infer<typeof MachineStartHeldSchema>;

/* A place a source of an extension can start a machine in, with how far its start is. */
export const MachineCandidateSchema = z.object({
    source: MachineSourceRefSchema,
    id: z.string().min(1),
    title: z.string().min(1),
    // Where it is, in the source's words.
    place: z.string(),
    // A machine already runs there, by what the source says.
    running: z.boolean(),
    state: MachineStartStateSchema,
    held: MachineStartHeldSchema.optional(),
    lines: z.array(z.string()),
    failure: z.string().optional(),
    // `signed` while `joining`: the new machine agreed and a client has to post it. `joined` once one said it did.
    join: z.enum(['signed', 'joined']).optional()
});
export type MachineCandidate = z.infer<typeof MachineCandidateSchema>;

const MachineCandidateTargetSchema = z.object({
    projectId: ProjectIdSchema,
    extension: z.string().min(1),
    source: z.string().min(1),
    candidate: z.string().min(1)
});

export const MachineSourceListPayloadSchema = z.object({ projectId: ProjectIdSchema });
export const MachineSourceListResultSchema = z.object({ candidates: z.array(MachineCandidateSchema) });
export type MachineSourceListResult = z.infer<typeof MachineSourceListResultSchema>;

export const MachineSourceStartPayloadSchema = MachineCandidateTargetSchema.extend({
    // A person's yes to what was held under this digest. A start that reads something else now is held again.
    approve: z.string().min(1).optional()
});
export const MachineSourceStartResultSchema = z.object({ candidate: MachineCandidateSchema });

/* `accountId` is the account the asking client is signed in to, which the machine only compares with its own. */
export const MachineSourceRegistrationPayloadSchema = MachineCandidateTargetSchema.extend({ accountId: z.string().min(1).max(64) });
export const MachineSourceRegistrationResultSchema = z.object({ registration: RegisterMachinePayloadSchema });

export const MachineSourceChangedEventSchema = z.object({
    projectId: ProjectIdSchema,
    candidate: MachineCandidateSchema
});
export type MachineSourceChangedEvent = z.infer<typeof MachineSourceChangedEventSchema>;

export const MACHINE_SOURCE_REQUEST_SCHEMAS = {
    // Asks the sources of the extensions what they list in the project, which also subscribes the client to their starts.
    'extension.machineList': { payload: MachineSourceListPayloadSchema, result: MachineSourceListResultSchema },
    // Answers once the source said what a start runs: held for a person's yes, or running.
    'extension.machineStart': { payload: MachineSourceStartPayloadSchema, result: MachineSourceStartResultSchema },
    // A person's stop of a start under way. Nothing the start made is removed.
    'extension.machineStop': { payload: MachineCandidateTargetSchema, result: EmptySchema },
    /*
     * What the new machine signed to be on this machine's account, for the client to post with its own session, as it
     * does after `endpoint.signRegistration`. Handed out once; a later ask has the new machine sign again.
     */
    'extension.machineRegistration': { payload: MachineSourceRegistrationPayloadSchema, result: MachineSourceRegistrationResultSchema },
    // The client posted the registration, which ends the start.
    'extension.machineJoined': { payload: MachineCandidateTargetSchema, result: EmptySchema }
} as const;

export const MACHINE_SOURCE_EVENT_SCHEMAS = {
    'extension.machineChanged': MachineSourceChangedEventSchema
} as const;
