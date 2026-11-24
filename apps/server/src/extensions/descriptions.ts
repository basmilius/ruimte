/*
 * What a provider of an extension hands back for Ruimte to run, checked the same way by the machine and by
 * `createTestServer`: a program to start, a launch that starts one, a place for a machine with what starts one there,
 * a UI source with what it answers a block, and what a reference or a slash command puts in a prompt.
 */
import {
    MAX_COMPOSER_TEXT,
    MAX_MACHINE_CANDIDATES,
    MAX_MACHINE_STEPS,
    MAX_REFERENCE_ITEMS,
    MAX_SOURCED_LAUNCHES,
    MAX_UI_SOURCE_ANSWER_BYTES,
    MAX_UI_SOURCE_DESCRIPTION,
    MAX_UI_SOURCE_PARAMETERS_BYTES
} from '@ruimte/contracts/extension-providers';
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

/* What a UI source says of itself, as the agent that writes a block is told. */
export interface UiSourceDescription {
    description: string;
    parameters?: object;
}

/* What a UI source said of itself, or the reason the machine does not take it. */
export function uiSourceDescribed(description: unknown, parameters: unknown): UiSourceDescription | string {
    if (typeof description !== 'string' || description.trim() === '' || description.length > MAX_UI_SOURCE_DESCRIPTION) {
        return `needs a description of at most ${MAX_UI_SOURCE_DESCRIPTION} characters`;
    }

    if (parameters === undefined) {
        return { description: description.trim() };
    }

    if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
        return 'takes parameters as a JSON Schema object';
    }

    if (Buffer.byteLength(JSON.stringify(parameters)) > MAX_UI_SOURCE_PARAMETERS_BYTES) {
        return `takes parameters of at most ${MAX_UI_SOURCE_PARAMETERS_BYTES} bytes`;
    }

    return { description: description.trim(), parameters };
}

/* What a UI source answered a read with, as a block gets it, or a throw that says why it does not. */
export function uiAnswerRead(answer: unknown): unknown {
    const text = JSON.stringify(answer ?? null);

    if (Buffer.byteLength(text) > MAX_UI_SOURCE_ANSWER_BYTES) {
        throw new Error(`answered more than ${MAX_UI_SOURCE_ANSWER_BYTES} bytes`);
    }

    // Through JSON, so a block never gets what JSON cannot say, whichever way the answer came.
    return JSON.parse(text) as unknown;
}

const ReferenceItemSchema = z.object({ id: z.string().min(1).max(200), name: z.string().trim().min(1).max(200) });
export type ReferenceItemDescription = z.infer<typeof ReferenceItemSchema>;

/* The things a reference answered `list` with, as the machine takes them, by the rules of `launchesListed`. */
export function referenceItemsListed(answer: unknown, refused: (reason: string) => void): ReferenceItemDescription[] {
    const items = new Map<string, ReferenceItemDescription>();

    for (const entry of (Array.isArray(answer) ? answer : []).slice(0, MAX_REFERENCE_ITEMS)) {
        const described = ReferenceItemSchema.safeParse(entry);

        if (!described.success) {
            const issue = described.error.issues[0];

            refused(`listed a thing that is none: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'invalid'}`);
        } else if (!items.has(described.data.id)) {
            items.set(described.data.id, described.data);
        }
    }

    return [...items.values()];
}

/* What a reference or a slash command puts in a prompt, or a throw that says why it does not. */
export function composerTextRead(answer: unknown): string {
    if (typeof answer !== 'string') {
        throw new Error('answered no text');
    }

    if (answer.length > MAX_COMPOSER_TEXT) {
        throw new Error(`answered more than ${MAX_COMPOSER_TEXT} characters`);
    }

    return answer;
}
