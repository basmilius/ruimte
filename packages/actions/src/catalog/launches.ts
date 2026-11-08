import {
    LaunchConfigEntrySchema,
    LaunchConfigKindSchema,
    LaunchStateSchema,
    RoutineEntrySchema,
    SECRET_LIMITS,
    SECRET_VARIABLE_PATTERN
} from '@ruimte/contracts';
import { z } from 'zod';
import {
    revision,
    optionalFields,
    AGENT,
    PERSON_AND_AGENT,
    PERSON,
    launchName,
    launchStarted,
    launchFields,
    launchFieldName,
    launchRunFields,
    launchSaved,
    routineId,
    routineFields,
    routineSaved,
    routineTitle,
    routineSchedule,
    routineRunFields,
    routineNamed
} from './fields.ts';

export const LAUNCH_ACTIONS = {
    'launch.save': {
        title: 'Save launches',
        description: 'Saves every launch of a project at once, against the revision it was read at; the save approves on this machine what it adds or changes.',
        effect: 'shared',
        domain: 'developer',
        // Saving approves, which is a person's alone; an agent adds and edits through launch.create and launch.edit, which approve nothing.
        actors: PERSON,
        input: z.object({
            projectId: z.string().min(1),
            baseRev: revision,
            launches: z.array(LaunchConfigEntrySchema),
            imported: z.array(z.string().min(1)).describe('The launches an import added in this save, which it leaves unapproved')
        }),
        output: z.object({ rev: z.number().int() })
    },
    'launch.list': {
        title: 'List launches',
        description: 'Lists the launches of the project with what runs of each on this machine and whether a person approved it here.',
        agentDescription: 'Lists the launches of the project: id, name, kind, state, approved, port, url',
        effect: 'read',
        domain: 'developer',
        actors: PERSON_AND_AGENT,
        input: z.object({}),
        output: z.object({
            launches: z.array(
                z.object({
                    launchId: z.string(),
                    name: z.string(),
                    kind: LaunchConfigKindSchema,
                    // Null for one that has not run since the machine started, and for a group, whose members each have one.
                    state: LaunchStateSchema.nullable(),
                    exitCode: z.number().int().nullable(),
                    approved: z.boolean(),
                    port: z.number().int().nullable(),
                    url: z.string().nullable(),
                    // The launches a group starts; empty for any other kind.
                    members: z.array(z.string())
                })
            )
        })
    },
    'launch.read': {
        title: 'Read a launch',
        description: 'Prints the output of a launch, whole or its last lines, as its terminal shows it now.',
        effect: 'read',
        domain: 'developer',
        actors: PERSON_AND_AGENT,
        input: z.object({
            launch: launchName,
            tail: z.number().int().min(1).nullable().describe('Only the last this many lines; without it the whole output')
        }),
        // Null when it has not run since the machine started.
        output: z.object({ launchId: z.string(), name: z.string(), text: z.string().nullable() })
    },
    'launch.create': {
        title: 'Add a launch',
        description:
            'Adds a launch to the project: a service, a task or a group of launches. It never starts until a person approves it on this machine as it stands.',
        effect: 'shared',
        domain: 'developer',
        // An agent's launch is never approved by its save; a person approves it from the launch chip.
        actors: PERSON_AND_AGENT,
        input: z.object({
            name: launchFieldName,
            kind: LaunchConfigKindSchema.describe('service runs until stopped, task runs once and ends, group starts other launches'),
            ...optionalFields(launchRunFields),
            shared: z.boolean().optional().describe("Puts it in the project's shared file, which a team commits; this person's own file when omitted")
        }),
        output: launchSaved
    },
    'launch.edit': {
        title: 'Change a launch',
        description: 'Changes fields of a launch of the project; a change to what it runs waits on a person to approve it again before it starts.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_AND_AGENT,
        input: z.object({ launch: launchName, ...optionalFields(launchFields) }),
        output: launchSaved
    },
    'launch.start': {
        title: 'Start a launch',
        description: 'Starts a launch a person approved on this machine as it stands now; one that already runs is left running.',
        effect: 'external',
        domain: 'developer',
        actors: PERSON_AND_AGENT,
        input: z.object({ launch: launchName }),
        output: launchStarted
    },
    'launch.restart': {
        title: 'Restart a launch',
        description: 'Stops a launch a person approved on this machine and starts it again, or starts it when it did not run.',
        effect: 'external',
        domain: 'developer',
        actors: PERSON_AND_AGENT,
        input: z.object({ launch: launchName }),
        output: launchStarted
    },
    'launch.stop': {
        title: 'Stop a launch',
        description: 'Stops a launch, or every launch of a group, with Ctrl+C and SIGTERM after a grace period; only a person kills one.',
        effect: 'external',
        domain: 'developer',
        actors: PERSON_AND_AGENT,
        input: z.object({ launch: launchName }),
        // How many of its launches ran and are being stopped.
        output: z.object({ launchId: z.string(), name: z.string(), stopping: z.number().int() })
    },
    'routine.list': {
        title: 'List routines',
        description: 'Lists the routines of the project: what each runs and when, whether a person approved it here, whether it is paused, and its last run.',
        effect: 'read',
        domain: 'developer',
        actors: PERSON_AND_AGENT,
        input: z.object({}),
        output: z.object({ routines: z.array(RoutineEntrySchema), timeZone: z.string() })
    },
    'routine.create': {
        title: 'Add a routine',
        description:
            'Adds a routine to the project that starts an agent, a command or a launch at a set time; it never runs until a person approves it on this machine as it stands.',
        effect: 'shared',
        domain: 'developer',
        // An agent's save never approves; a person saves and approves through Routines in the app.
        actors: PERSON_AND_AGENT,
        input: z.object({
            title: routineTitle,
            schedule: routineSchedule,
            ...optionalFields(routineRunFields),
            shared: z.boolean().optional().describe("Puts it in the project's shared file, which a team commits; this person's own file when omitted")
        }),
        output: routineSaved
    },
    'routine.edit': {
        title: 'Change a routine',
        description: 'Changes fields of a routine of the project; a change that touches what it runs or when waits on a person to approve it again.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_AND_AGENT,
        input: z.object({ routineId, ...optionalFields(routineFields) }),
        output: routineSaved
    },
    'routine.pause': {
        title: 'Pause a routine',
        description: 'Pauses a routine on this machine, so it starts nothing until it is resumed.',
        effect: 'local',
        domain: 'developer',
        actors: PERSON_AND_AGENT,
        input: z.object({ routineId }),
        output: routineNamed
    },
    'routine.resume': {
        title: 'Resume a routine',
        description: 'Resumes a paused routine from its next time on; the times it was paused through do not run.',
        effect: 'local',
        domain: 'developer',
        actors: PERSON_AND_AGENT,
        input: z.object({ routineId }),
        output: routineNamed
    },
    'routine.run': {
        title: 'Run a routine now',
        description: 'Starts a run of a routine now, only when a person approved it on this machine as it stands and its previous run has ended.',
        effect: 'external',
        domain: 'developer',
        actors: PERSON_AND_AGENT,
        input: z.object({ routineId }),
        output: routineNamed.extend({ runId: z.string() })
    },
    'secret.request': {
        title: 'Ask for a secret',
        description:
            "Asks the person, in a private card of the caller's chat, for the value of a variable of a launch; the value stays on this machine and only that launch's process gets it.",
        effect: 'external',
        domain: 'developer',
        actors: AGENT,
        input: z.object({
            launch: launchName,
            variable: z
                .string()
                .regex(SECRET_VARIABLE_PATTERN, 'A variable is letters, digits and underscores, not starting with a digit')
                .max(SECRET_LIMITS.variable)
                .describe('The environment variable of the launch the secret is bound to'),
            label: z.string().trim().min(1).max(SECRET_LIMITS.label).describe('What the person is asked for, such as the name of a service and its key'),
            reason: z.string().trim().min(1).max(SECRET_LIMITS.reason).describe('Why the launch needs it, in one or two sentences'),
            placeholder: z.string().trim().min(1).max(SECRET_LIMITS.placeholder).nullish().describe('A hint inside the field, such as the shape of the key'),
            wait: z
                .number()
                .int()
                .min(1)
                .max(110)
                .nullish()
                .describe('Seconds the call holds for the answer; 6 without it. A card that still waits after that is answered by asking again')
        }),
        // Never the value: only what became of the card, and on saved the variable now bound.
        output: z.object({
            requestId: z.string(),
            outcome: z.enum(['saved', 'declined', 'cancelled', 'timed-out', 'waiting']),
            launchId: z.string(),
            name: z.string(),
            variable: z.string()
        })
    }
} as const;
