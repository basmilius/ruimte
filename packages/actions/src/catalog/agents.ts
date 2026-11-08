import { AgentKindSchema, ChatSubagentSourceSchema, ContextSourceSchema, RuntimeModeSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_OPENED_PER_CALLER, MAX_PROMPT_LENGTH } from '../limits.ts';
import {
    viewId,
    nodeId,
    givenName,
    agentField,
    PERSON_VOICE_AND_AGENT,
    AGENT,
    PERSON_AND_AGENT,
    operatedView,
    OperationStatusSchema,
    OPERATION_ACTIONS,
    agentNodeKind,
    agentReads,
    drawnLine,
    chatReadUsage
} from './fields.ts';

export const AGENT_ACTIONS = {
    'context.list': {
        title: 'List linked context',
        description: 'Lists the context a person linked to this session: the id, kind and title of each source.',
        effect: 'read',
        domain: 'communicate',
        actors: AGENT,
        input: z.object({}),
        output: z.object({
            sources: z.array(
                ContextSourceSchema.pick({ id: true, kind: true, title: true, flag: true }).extend({
                    snoozedUntil: z.iso.datetime().optional().describe('When the snooze a person put on the node ends; absent for none')
                })
            )
        })
    },
    'context.read': {
        title: 'Read linked context',
        description: 'Prints one linked source, whole or its last lines.',
        effect: 'read',
        domain: 'communicate',
        actors: PERSON_AND_AGENT,
        input: z.object({
            sourceId: z
                .string()
                .min(1)
                .describe(
                    'The id of a source, as context.list gives it, or of an agent the caller opened itself; a drawing or diagram also takes the id of the linked node that shows it'
                ),
            tail: z.number().int().min(1).nullable().describe('Only the last this many lines; without it the whole source'),
            viewId: operatedView,
            subagent: z
                .string()
                .min(1)
                .nullable()
                .describe(
                    `The whole conversation of one subagent of a chat the caller may read instead of the chat, read from ${ChatSubagentSourceSchema.options.join(' or ')}`
                ),
            form: z
                .enum(['elements', 'image'])
                .nullish()
                .describe(
                    'Instead of the text: the elements of a drawing as JSON, or a PNG of a drawing, a diagram or a canvas written to the chat and named by its path'
                )
        }),
        output: z.object({
            text: z.string(),
            usage: chatReadUsage.optional().describe('Only on a chat read whole or by its tail, not on a subagent of it'),
            image: z.string().optional().describe('The path of the PNG a read in form image wrote')
        })
    },
    'agent.start': {
        title: 'Start an agent',
        description: 'Starts an agent in this project',
        effect: 'external',
        domain: 'agents',
        // Voice starts a chat with the person's CLI and nothing more: what only an agent gives stays an agent field.
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({
            provider: AgentKindSchema.describe('The CLI the agent runs'),
            terminal: z.boolean().describe('Makes a terminal node instead of a chat node'),
            prompt: z.string().nullish().describe('What the agent starts working on'),
            promptFile: agentField(z.string().min(1)).describe('The same prompt out of a file, for one with exact bytes'),
            cwd: agentField(z.string().min(1)).describe('The directory the agent starts in'),
            reads: agentField(z.array(nodeId)).describe('Nodes the new agent can read from its first turn: a line is drawn from each of them into it'),
            viewId: viewId.nullish().describe('The canvas to add to; null uses your canvas or keeps the agent hidden from a chat view'),
            beside: nodeId.nullish().describe('Puts the node directly right of this node, top edges level'),
            group: agentField(nodeId).describe('Puts the node inside this group node of that canvas'),
            title: givenName.nullish().describe('The title; without one the node is called after the CLI, and the session may rename it'),
            task: agentField(givenName).describe('Gives the new agent a task with this title, which the prompt describes and whose result wakes you'),
            model: z.string().trim().min(1).nullish().describe("The model id for a chat agent, with that model's default options"),
            mode: RuntimeModeSchema.nullish().describe(
                'The permission mode the agent runs in: supervised, auto-accept-edits, auto or full-access, never wider than your own'
            ),
            worktree: agentField(z.boolean()).describe('Starts the agent in a git worktree of its own on a new branch'),
            branch: agentField(z.string().min(1)).describe('The branch of that worktree instead of one named after the task or the title'),
            requestId: z
                .string()
                .regex(/^[A-Za-z0-9._:-]{1,128}$/)
                .nullish()
                .describe('An id of your choosing; a retry with the same id and the same input answers with what the first call made'),
            base: agentField(z.string().min(1)).describe('With a worktree: the branch, tag or commit a new branch starts at instead of HEAD'),
            machine: agentField(z.string().min(1)).describe(
                'Runs the agent on another machine this project is linked to, named by its name or id; needs a task, and a worktree there is made from your checkout'
            ),
            effort: z
                .string()
                .trim()
                .min(1)
                .nullish()
                .describe("The reasoning effort for a chat agent, one the model offers; null keeps the person's last pick when the model offers it"),
            account: agentField(z.string().min(1)).describe(
                "An account a person named in the calling chat as @account:<cli>/<id>, for this CLI; null inherits the caller's"
            )
        }),
        output: z.object({
            nodeId,
            kind: agentNodeKind,
            viewId: viewId.nullable(),
            provider: AgentKindSchema,
            // The line from you into the agent; null when you are no node on that canvas.
            edge: drawnLine.nullable(),
            reads: z.array(drawnLine),
            // Null without a task, and in a dry run, which gives none.
            taskId: z.string().nullable()
        })
    },
    'team.start': {
        title: 'Start a team',
        description: `Starts a team of up to ${MAX_OPENED_PER_CALLER} agents in this project`,
        effect: 'external',
        domain: 'agents',
        actors: PERSON_AND_AGENT,
        input: z.object({
            label: givenName.describe('The name of the group the agents land in'),
            roles: z
                .array(
                    z.object({
                        title: givenName.describe('The title of the node; the session never renames over it'),
                        prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH).describe('What that agent starts working on'),
                        provider: AgentKindSchema,
                        model: z.string().trim().min(1).nullable().describe("The model id for a chat role, with that model's default options"),
                        terminal: z.boolean().describe('Opens a terminal node instead of a chat node'),
                        effort: z
                            .string()
                            .trim()
                            .min(1)
                            .nullish()
                            .describe("The reasoning effort for a chat role, one the model offers; null keeps the person's last pick when the model offers it"),
                        account: z
                            .string()
                            .min(1)
                            .nullish()
                            .describe("An account a person named in the calling chat as @account:<cli>/<id>, for this role's CLI; null inherits the caller's")
                    })
                )
                .min(1)
                .max(MAX_OPENED_PER_CALLER),
            cwd: z.string().min(1).nullable().describe('The directory every agent starts in'),
            reads: agentReads,
            viewId: viewId.nullable().describe('The canvas to add to; null uses your canvas or keeps the agents hidden from a chat view'),
            mode: RuntimeModeSchema.nullable().describe(
                'The permission mode every role runs in: supervised, auto-accept-edits, auto or full-access, never wider than your own'
            ),
            worktree: z.boolean().describe('Starts every role in a git worktree of its own, on a new branch named after the role'),
            task: z
                .boolean()
                .describe(
                    'Gives every role a task titled after the role, which its prompt describes; you are woken once, with the results of all roles, when the last of them settles'
                ),
            machine: z
                .string()
                .min(1)
                .nullish()
                .describe(
                    'Runs every role on another machine this project is linked to, named by its name or id; needs a task, and a worktree there is made from your checkout'
                )
        }),
        output: z.object({
            group: z.object({ nodeId, title: z.string(), viewId }).nullable(),
            agents: z.array(
                z.object({
                    nodeId,
                    kind: agentNodeKind,
                    title: z.string(),
                    provider: AgentKindSchema,
                    edge: drawnLine.nullable(),
                    taskId: z.string().nullable()
                })
            ),
            reads: z.array(drawnLine)
        })
    },
    'operation.get': {
        title: 'Follow an operation',
        description: 'Reads where an operation an action answered with stands: queued, running, completed, failed or cancelled, per agent it started.',
        effect: 'read',
        domain: 'agents',
        actors: PERSON_AND_AGENT,
        input: z.object({ operationId: z.string().min(1).describe('The id the action answered with') }),
        output: z.object({
            operationId: z.string(),
            action: z.enum(OPERATION_ACTIONS),
            status: OperationStatusSchema,
            agents: z.array(z.object({ nodeId, status: OperationStatusSchema, taskId: z.string().nullable(), detail: z.string() }))
        })
    },
    'operation.cancel': {
        title: 'Cancel an operation',
        description:
            'Stops an operation of your own that still runs: a git run, or the turns an agent or team start set going. Nothing is rolled back; each line says what is left.',
        agentDescription:
            'Stops the turns an agent or team you started is working on. The chats and their tasks stay, a terminal agent is left running, and nothing is rolled back; each line says what is left.',
        effect: 'shared',
        domain: 'developer',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({
            operationId: z
                .string()
                .min(1)
                .nullable()
                .describe('git:<run> for a git run, agent.start:<id> or team.start:<id>,<id> for a start; null for every git run of yours still going')
        }),
        output: z.object({
            operations: z.array(z.object({ operationId: z.string(), status: z.enum(['cancelled', 'over', 'left']), detail: z.string() }))
        })
    }
} as const;
