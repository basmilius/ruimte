import { AgentKindSchema, AgentStatusSchema, RuntimeModeSchema, TaskSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_OPENED_PER_CALLER, MAX_PROMPT_LENGTH } from '../limits.ts';
import {
    PERSON_AND_VOICE,
    AGENT,
    viewId,
    nodeId,
    givenName,
    agentField,
    CLIENT_ACTORS,
    drawnLine,
    OperationStatusSchema,
    OPERATION_ACTIONS,
    agentNodeKind,
    agentReads,
    PERSON_VOICE_AGENT_AND_EXTENSION,
    PERSON_AND_AGENT
} from './fields.ts';

export const AGENTS_ACTIONS = {
    'agents.inspect': {
        title: 'Inspect agents',
        description: 'Reads current agent statuses in this project from the daemon.',
        effect: 'read',
        domain: 'agents',
        actors: CLIENT_ACTORS,
        input: z.object({}),
        output: z.object({
            project: z.string(),
            connected: z.boolean(),
            observedAt: z.number(),
            agents: z.array(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    view: z.string(),
                    kind: z.enum(['chat', 'terminal']),
                    status: z.union([AgentStatusSchema, z.literal('unknown')]),
                    working: z.boolean().nullable(),
                    selected: z.boolean(),
                    toolHistory: z.boolean(),
                    updatedAt: z.number().nullable()
                })
            )
        })
    },
    'agent.activity': {
        title: 'Read agent activity',
        description: 'Reads bounded structured tool activity, never internal reasoning.',
        effect: 'read',
        domain: 'agents',
        actors: CLIENT_ACTORS,
        input: z.object({ agentId: z.string().min(1), limit: z.number().int().min(1).max(20), toolId: z.string().nullable() }),
        output: z.object({
            agent: z.string(),
            supported: z.boolean(),
            truncated: z.boolean(),
            tools: z.array(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    state: z.enum(['running', 'done', 'error']),
                    createdAt: z.number(),
                    input: z.string(),
                    output: z.string().nullable(),
                    parentToolUseId: z.string().nullable(),
                    paths: z.array(z.string()),
                    truncated: z.boolean()
                })
            )
        })
    },
    'extension.voiceList': {
        title: 'List extension actions',
        description: 'Lists what the extensions of this window offer by voice, each with what it does and the input it takes.',
        effect: 'read',
        domain: 'agents',
        actors: PERSON_AND_VOICE,
        input: z.object({}),
        output: z.object({ actions: z.array(z.object({ id: z.string(), description: z.string(), parameters: z.string() })) })
    },
    'extension.voiceRun': {
        title: 'Run an extension action',
        description: 'Runs what an extension offers by voice, with its input as JSON, and says what it answers.',
        effect: 'local',
        domain: 'agents',
        actors: PERSON_AND_VOICE,
        input: z.object({
            id: z.string().min(1).max(256).describe('As extension.voiceList names it'),
            input: z.string().max(10_000).describe('Its input, as JSON')
        }),
        output: z.object({ text: z.string() })
    },
    'tool.list': {
        title: 'List extension tools',
        description: 'Lists the tools the extensions on this machine offer agents, each with what it does and the input it takes.',
        effect: 'read',
        domain: 'agents',
        actors: PERSON_AND_AGENT,
        input: z.object({}),
        output: z.object({ tools: z.array(z.object({ id: z.string(), description: z.string(), parameters: z.string() })) })
    },
    'tool.run': {
        title: 'Run an extension tool',
        description: 'Runs a tool an extension on this machine offers, with its input as JSON, and prints what it answers.',
        effect: 'external',
        domain: 'agents',
        actors: PERSON_AND_AGENT,
        input: z.object({
            id: z.string().min(1).max(256).describe('The tool, as tool list prints it'),
            input: z.string().max(100_000).describe('Its input, as JSON')
        }),
        output: z.object({ text: z.string() })
    },
    'agent.answer': {
        title: 'Answer an agent',
        description: 'Answers a question an agent you opened asked and waits on, the way a person answers it in that node; an approval stays with the person.',
        effect: 'external',
        domain: 'agents',
        actors: PERSON_AND_AGENT,
        input: z.object({
            nodeId: nodeId.describe('The agent that asked, by id; only one you opened yourself'),
            requestId: z.string().min(1).describe('The request the question came with, as the > Question line of a read or the note about it names it'),
            answer: z
                .string()
                .nullable()
                .describe('The answer to a request with one question: a choice label as written, several separated by a comma, or your own words'),
            answers: z.record(z.string(), z.string()).nullable().describe('The answers to a request with several questions, keyed by question id')
        }),
        output: z.object({ nodeId, requestId: z.string() })
    },
    'task.list': {
        title: 'List tasks',
        description:
            'Lists the tasks you gave and the task you were given that are still open or have yet to wake you: id, direction, status, the other node, title, wake, result, batch.',
        effect: 'read',
        domain: 'agents',
        actors: PERSON_AND_AGENT,
        input: z.object({
            all: z.boolean().describe('Also lists the history: tasks that settled and already woke their chat, and a task you were given that settled')
        }),
        output: z.object({
            tasks: z.array(TaskSchema),
            // What the list left out without all: settled tasks that already reported.
            hidden: z.number().int()
        })
    },
    'task.create': {
        title: 'Give a task',
        description: 'Gives a task to an agent you opened that is already running, whose result wakes you the way the task of a new one does.',
        effect: 'external',
        domain: 'agents',
        actors: PERSON_AND_AGENT,
        input: z.object({
            nodeId: nodeId.describe('The agent to give the task to, by id; only a chat you opened yourself'),
            prompt: z.string().nullable().describe('What the task asks'),
            promptFile: agentField(z.string().min(1)).describe('The same assignment out of a file, for one with exact bytes'),
            title: givenName.nullable().describe('The title of the task; without one the first line of the prompt')
        }),
        output: z.object({
            taskId: z.string(),
            nodeId,
            // Now for an agent that starts on it as you call, waiting for one still in a turn.
            at: z.enum(['now', 'waiting'])
        })
    },
    'task.complete': {
        title: 'Report a task',
        description: 'Reports the result of the task you were opened with, which wakes the chat that gave it.',
        effect: 'external',
        domain: 'agents',
        actors: AGENT,
        input: z.object({
            result: z.string().nullable().describe('The result'),
            resultFile: agentField(z.string().min(1)).describe('The same result out of a file inside the project folder')
        }),
        output: z.object({ taskId: z.string(), parentId: nodeId })
    },
    'agent.start': {
        title: 'Start an agent',
        description: 'Starts an agent in this project',
        effect: 'external',
        domain: 'agents',
        // Voice starts a chat with the person's CLI and nothing more: what only an agent gives stays an agent field.
        actors: PERSON_VOICE_AGENT_AND_EXTENSION,
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
    }
} as const;
