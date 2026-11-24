/*
 * What a provider of an extension hands back for Ruimte to run, checked the same way by the machine and by
 * `createTestServer`: a program to start, a launch that starts one, and a place for a machine with what starts one there.
 */
import { MAX_MACHINE_CANDIDATES, MAX_MACHINE_STEPS, MAX_SOURCED_LAUNCHES } from '@ruimte/contracts/extension-providers';
import { z } from 'zod';

const PROVIDED_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const SpawnDescriptionSchema = z.object({
    command: z.string().min(1),
    args: z.array(z.string()).max(256).optional(),
    env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).optional(),
    cwd: z.string().min(1).optional()
});
export type SpawnDescription = z.infer<typeof SpawnDescriptionSchema>;

export const LaunchDescriptionSchema = z.object({
    id: z.string().regex(PROVIDED_ID),
    name: z.string().trim().min(1).max(200),
    kind: z.enum(['service', 'task']),
    spawn: SpawnDescriptionSchema,
    fingerprint: z.string().min(1).max(256),
    port: z.number().int().min(1).max(65_535).optional()
});
export type LaunchDescription = z.infer<typeof LaunchDescriptionSchema>;

export const MachineCandidateDescriptionSchema = z.object({
    id: z.string().regex(PROVIDED_ID),
    title: z.string().trim().min(1).max(200),
    place: z.string().trim().max(200),
    running: z.boolean()
});
export type MachineCandidateDescription = z.infer<typeof MachineCandidateDescriptionSchema>;

export const MachineStartDescriptionSchema = z.object({
    steps: z
        .array(z.object({ title: z.string().trim().min(1).max(200), spawn: SpawnDescriptionSchema }))
        .min(1)
        .max(MAX_MACHINE_STEPS),
    login: SpawnDescriptionSchema.optional(),
    fingerprint: z.string().min(1).max(256)
});
export type MachineStartDescription = z.infer<typeof MachineStartDescriptionSchema>;

/* The places a machine source answered `list` with, as the machine takes them, by the rules of `launchesListed`. */
export function candidatesListed(answer: unknown, refused: (reason: string) => void): MachineCandidateDescription[] {
    const candidates = new Map<string, MachineCandidateDescription>();

    for (const entry of (Array.isArray(answer) ? answer : []).slice(0, MAX_MACHINE_CANDIDATES)) {
        const described = MachineCandidateDescriptionSchema.safeParse(entry);

        if (!described.success) {
            const issue = described.error.issues[0];

            refused(`listed a place that is none: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'invalid'}`);
        } else if (!candidates.has(described.data.id)) {
            candidates.set(described.data.id, described.data);
        }
    }

    return [...candidates.values()];
}

/* What a machine source answered `start` with, or a throw that says what is wrong with it. */
export function machineStartDescribed(answer: unknown): MachineStartDescription {
    const described = MachineStartDescriptionSchema.safeParse(answer);

    if (!described.success) {
        const issue = described.error.issues[0];

        throw new Error(`described a start that is none: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'invalid'}`);
    }

    return described.data;
}

/*
 * The launches a source answered `list` with, as the machine takes them: the first of each id, at most
 * `MAX_SOURCED_LAUNCHES`, and none that is no launch, each of which `refused` hears the reason of.
 */
export function launchesListed(answer: unknown, refused: (reason: string) => void): LaunchDescription[] {
    const launches = new Map<string, LaunchDescription>();

    for (const entry of (Array.isArray(answer) ? answer : []).slice(0, MAX_SOURCED_LAUNCHES)) {
        const described = LaunchDescriptionSchema.safeParse(entry);

        if (!described.success) {
            const issue = described.error.issues[0];

            refused(`listed a launch that is none: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'invalid'}`);
        } else if (!launches.has(described.data.id)) {
            launches.set(described.data.id, described.data);
        }
    }

    return [...launches.values()];
}
