/*
 * What a provider of an extension hands back for Ruimte to run, checked the same way by the machine and by
 * `createTestServer`: a program to start, and a launch that starts one.
 */
import { MAX_SOURCED_LAUNCHES } from '@ruimte/contracts/extension-providers';
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
