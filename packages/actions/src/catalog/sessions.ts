import {
    AgentKindSchema,
    AgentStatusSchema,
    ProviderAccountIdSchema,
    RuntimeModeSchema,
    TerminalPrepareSourceSchema,
    TerminalPreparePreviewResultSchema,
    TerminalPrepareResultSchema,
    ChatBackgroundTaskSchema,
    ChatCheckpointDiffSchema,
    ChatExternalResultSchema,
    ChatSearchResultSchema,
    ChatSubagentStatusSchema
} from '@ruimte/contracts';
import { z } from 'zod';
import {
    PERSON_AND_VOICE,
    PERSON,
    givenName,
    forActors,
    PERSON_VOICE_AND_AGENT,
    chatTarget,
    terminalTarget,
    chatNamed,
    terminalNamed,
    queuedMessage,
    queuedMessageOutput,
    modelOptions,
    modelSelection,
    questionAnswers,
    recentMessages
} from './fields.ts';

export const SESSIONS_ACTIONS = {
    'terminal.preparePreview': {
        title: 'Preview terminal input',
        description: 'Shows one completed chat code block and suitable empty shells on the chat machine. Writes no input.',
        actors: PERSON,
        domain: 'sessions',
        effect: 'read',
        input: TerminalPrepareSourceSchema.extend({ endpointId: z.string().min(1), machineId: z.string().min(1) }),
        output: TerminalPreparePreviewResultSchema
    },
    'terminal.prepare': {
        title: 'Prepare in terminal',
        description: 'Pastes the exact command a person previewed into that unchanged empty shell, without Enter.',
        actors: PERSON,
        domain: 'sessions',
        effect: 'local',
        input: z.object({ endpointId: z.string().min(1), machineId: z.string().min(1), token: z.string().min(1) }),
        output: TerminalPrepareResultSchema
    },
    'chat.search': {
        title: 'Search the chats of the project',
        description: 'Finds a word in the messages of every chat of the project, grouped by chat. Read only.',
        effect: 'read',
        domain: 'sessions',
        actors: PERSON,
        input: z.object({
            query: z.string().min(1).max(256).describe('The text to find'),
            searchId: z.string().min(1).max(64).describe('Names the search, so a newer one can cancel it')
        }),
        output: ChatSearchResultSchema
    },
    'chat.external': {
        title: 'List CLI sessions started outside the app',
        description: 'Lists the Claude and Codex sessions that were started in the folder of the project outside the app, newest first. Read only.',
        effect: 'read',
        domain: 'sessions',
        actors: PERSON,
        input: z.object({}),
        output: ChatExternalResultSchema
    },
    'chat.inspect': {
        title: 'Inspect AI Chat',
        description:
            'Reads what an AI Chat runs on and what waits in it: CLI, model and options, permission mode, whether a turn runs, queued messages, questions and approvals waiting for the user, sub-agents, background tasks, the last finished turn and where a fork came from. The thread itself is only known while the chat is open in this window.',
        effect: 'read',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({ chatId: chatTarget }),
        output: chatNamed.extend({
            provider: AgentKindSchema,
            model: z.string(),
            options: modelOptions,
            runtimeMode: RuntimeModeSchema,
            status: AgentStatusSchema,
            working: z.boolean(),
            // False when nobody in this window has the thread open, so the lists below the queue are empty.
            open: z.boolean(),
            queue: z.array(z.object({ messageId: z.string(), text: z.string() })),
            questions: z.array(
                z.object({
                    requestId: z.string(),
                    itemId: z.string(),
                    // The CLI goes on while it waits, so the question may also be dismissed.
                    optional: z.boolean(),
                    questions: z.array(
                        z.object({ questionId: z.string(), header: z.string(), question: z.string(), choices: z.array(z.string()), multiSelect: z.boolean() })
                    )
                })
            ),
            approvals: z.array(z.object({ requestId: z.string(), tool: z.string(), description: z.string().nullable() })),
            subagents: z.array(z.object({ toolUseId: z.string(), title: z.string(), status: ChatSubagentStatusSchema, stoppable: z.boolean() })),
            tasks: z.array(
                z.object({ taskId: z.string(), kind: ChatBackgroundTaskSchema.shape.kind, description: z.string(), command: z.string().nullable() })
            ),
            lastTurnId: z.string().nullable(),
            forkOf: z.object({ chatId: z.string(), turnId: z.string() }).nullable()
        })
    },
    'chat.stopTurn': {
        title: 'Stop AI Chat turn',
        description:
            'Stops the turn an AI Chat is in, after confirmation. What the turn wrote and changed so far stays, but the turn is not finished. With subagents it also ends the agents the chat opened.',
        effect: 'external',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({
            chatId: chatTarget,
            subagents: z.boolean().describe('Also ends the agents this chat opened and marks its CLI’s own sub-agents stopped')
        }),
        output: chatNamed.extend({ subagents: z.boolean() })
    },
    'chat.unqueue': {
        title: 'Take back a queued message',
        description: 'Takes a message that waits for the running turn out of the queue of an AI Chat, unsent.',
        effect: 'external',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: queuedMessage,
        output: queuedMessageOutput
    },
    'chat.sendNow': {
        title: 'Send a queued message now',
        description: 'Stops the running turn of an AI Chat and sends this queued message first.',
        effect: 'external',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: queuedMessage,
        output: queuedMessageOutput
    },
    'chat.compact': {
        title: 'Compact AI Chat',
        description: 'Has the CLI of an AI Chat compact its conversation into a summary, which frees context. Not while a turn runs.',
        effect: 'external',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({ chatId: chatTarget }),
        output: chatNamed
    },
    'chat.restart': {
        title: 'Restart agent session',
        description:
            'Ends the CLI process of an AI Chat and keeps its conversation: the next message resumes it in a fresh process, which reads new skills, plugins, commands and MCP servers. Not while the chat works.',
        effect: 'external',
        domain: 'sessions',
        // Ending another chat's process is a person's call alone.
        actors: PERSON,
        input: z.object({ chatId: chatTarget }),
        output: chatNamed
    },
    'chat.configure': {
        title: 'Configure AI Chat',
        description:
            'Changes the model of an AI Chat to another of its own CLI, or one option of the model such as reasoning effort, by the ids the provider lists. The CLI takes it from the next message on.',
        effect: 'external',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({
            chatId: chatTarget,
            model: z.string().trim().min(1).nullable().describe('A model slug of the chat’s CLI; null keeps the model'),
            option: z
                .object({ id: z.string().min(1), value: z.string().min(1).describe('A choice id, or true or false for an on and off option') })
                .nullable()
                .describe('One option of the model to set; null leaves the options'),
            // Widening what a chat may do without asking is a person's call alone.
            runtimeMode: forActors(PERSON, RuntimeModeSchema).describe('The permission mode'),
            // Letting the machine take a chat up again on a clock is a person's call alone.
            resumeAtReset: forActors(PERSON, z.boolean()).describe('Whether the chat goes on by itself once a limit it stopped on lifts'),
            selection: modelSelection,
            // An account is someone's costs, so only a person picks one, by hand or by voice.
            account: forActors(PERSON_AND_VOICE, ProviderAccountIdSchema).describe(
                'The account of the chat’s CLI on this machine that the next turn runs under. After the first turn only one that reads the same conversation'
            )
        }),
        output: chatNamed.extend({ provider: AgentKindSchema, model: z.string(), options: modelOptions, runtimeMode: RuntimeModeSchema })
    },
    'chat.setProvider': {
        title: 'Switch AI Chat CLI',
        description: 'Points an AI Chat that has not started yet at another installed CLI. A chat that started keeps its CLI.',
        effect: 'external',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({
            chatId: chatTarget,
            provider: AgentKindSchema.describe('The CLI the chat runs'),
            model: z.string().trim().min(1).nullable().describe('A model slug of that CLI; null takes its default'),
            selection: modelSelection
        }),
        output: chatNamed.extend({ provider: AgentKindSchema })
    },
    'chat.fork': {
        title: 'Fork AI Chat',
        description:
            'Starts a new AI Chat beside this one that goes on after one of its turns, with the history up to it. Without a turn it goes on after the last finished one; with a branch it works in a new worktree on that branch, after confirmation.',
        agentDescription:
            'Forks an AI Chat you opened yourself after one of its turns into a new chat of yours, with the history up to it, in your mode or narrower; give it work with task new.',
        effect: 'shared',
        domain: 'sessions',
        // An agent's fork is a child of that agent, so it holds to the depth, the count and the mode ceiling of one.
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({
            chatId: chatTarget,
            turnId: z.string().min(1).nullable().describe('The turn it goes on after, by id'),
            title: givenName.nullable().describe('The title of the fork'),
            branch: z.string().trim().min(1).nullable().describe('A new worktree on this branch; null works in the original’s folder'),
            asView: forActors(PERSON, z.boolean()).describe('Makes a chat view of a fork of a node'),
            filesAfterTurn: forActors(PERSON, z.boolean()).describe('Puts the files in the worktree as they were after the turn'),
            provider: forActors(PERSON, AgentKindSchema).describe('Another CLI to go on with'),
            selection: modelSelection,
            account: forActors(PERSON_AND_VOICE, ProviderAccountIdSchema).describe(
                'The account of the CLI on this machine the fork goes on under. Absent stays on the original’s account, or takes the default account of another CLI'
            )
        }),
        output: z.object({ chatId: z.string(), nodeId: z.string(), viewId: z.string(), chat: z.string(), branch: z.string().nullable() })
    },
    'chat.continueOn': {
        title: 'Continue AI Chat on another account',
        description:
            'Goes on after the last turn of an AI Chat, which stopped on a usage limit, under another account of its CLI on this machine, and sends that turn again. An account that reads the same conversation takes the chat over; any other goes on in a fork beside it.',
        effect: 'external',
        domain: 'sessions',
        // Moving a turn onto someone's other plan is never done without a person asking for it.
        actors: PERSON_AND_VOICE,
        input: z.object({
            chatId: chatTarget,
            account: ProviderAccountIdSchema.describe('The account of the chat’s CLI to go on under')
        }),
        output: chatNamed.extend({ forked: z.boolean().describe('Whether it went on in a fork, whose chat id is `chatId`') })
    },
    'chat.summarize': {
        title: 'Summarize a fork',
        description:
            'Has a fork write in a turn of its own what it did, which goes to the chat it was forked from as a note once that turn ends. Not while a turn runs.',
        effect: 'external',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({ chatId: chatTarget.describe('The fork, by id') }),
        output: chatNamed.extend({ turnId: z.string(), original: z.string() })
    },
    'chat.turnDiff': {
        title: 'Read what a turn changed',
        description: 'Reads the files a turn of an AI Chat changed against the checkpoint it started from, with a diff per file.',
        effect: 'read',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({ chatId: chatTarget, turnId: z.string().min(1).describe('The turn, by id') }),
        // Null when the turn has no checkpoint: no repository, or git could not be read.
        output: z.object({ chatId: z.string(), turnId: z.string(), diff: ChatCheckpointDiffSchema.nullable() })
    },
    'chat.readSubagent': {
        title: 'Read a sub-agent',
        description:
            'Reads a limited recent excerpt of what a sub-agent of an AI Chat wrote and was asked, without reasoning or tool output. A null limit reads the last 20 messages.',
        effect: 'read',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({
            chatId: chatTarget,
            toolUseId: z.string().min(1).describe('The sub-agent, by the id chat.inspect gives it'),
            limit: z.number().int().min(1).max(20).nullable()
        }),
        output: z.object({ chatId: z.string(), toolUseId: z.string(), live: z.boolean(), messages: recentMessages, truncated: z.boolean() })
    },
    'chat.stopSubagent': {
        title: 'Stop a sub-agent',
        description:
            'Stops a running sub-agent of an AI Chat after confirmation: an agent opened with a task is ended and its task cancelled, one of the CLI’s own is only marked stopped once the turn is over.',
        effect: 'external',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({ chatId: chatTarget, toolUseId: z.string().min(1).describe('The sub-agent, by the id chat.inspect gives it') }),
        output: chatNamed.extend({ toolUseId: z.string(), subagent: z.string() })
    },
    'chat.stopTask': {
        title: 'Stop a background task',
        description: 'Stops a command or monitor an AI Chat keeps running beside its turns, after confirmation.',
        effect: 'external',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({ chatId: chatTarget, taskId: z.string().min(1).describe('The background task, by the id chat.inspect gives it') }),
        output: chatNamed.extend({ taskId: z.string(), task: z.string() })
    },
    'chat.goal': {
        title: 'Pause, resume or clear a goal',
        description:
            'Acts on the goal an AI Chat works toward on its own (`/goal`), after confirmation. Pause and resume only where the CLI has them (Codex); clear also on Claude Code, between turns. A paused or cleared goal opens no further turn.',
        effect: 'external',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({ chatId: chatTarget, change: z.enum(['pause', 'resume', 'clear']).describe('What to do to the goal') }),
        output: chatNamed.extend({ change: z.enum(['pause', 'resume', 'clear']), objective: z.string() })
    },
    'chat.answer': {
        title: 'Answer an agent’s question',
        description:
            'Answers a question an AI Chat asked the user, every question of it at once, after a confirmation that repeats the answers. Pass the user’s own words, never an answer of your own.',
        effect: 'external',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({
            chatId: chatTarget,
            requestId: z.string().min(1).describe('The question, by the id chat.inspect gives it'),
            answers: questionAnswers
        }),
        output: chatNamed.extend({ requestId: z.string() })
    },
    'chat.dismissQuestion': {
        title: 'Dismiss an optional question',
        description: 'Leaves an optional question of an AI Chat unanswered, after confirmation. The agent is not told and goes on as it was.',
        effect: 'external',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({ chatId: chatTarget, itemId: z.string().min(1).describe('The question, by the itemId chat.inspect gives it') }),
        output: chatNamed.extend({ itemId: z.string() })
    },
    'chat.approve': {
        title: 'Answer a tool approval',
        description: 'Allows or denies a tool call an AI Chat waits on.',
        effect: 'external',
        domain: 'sessions',
        // Letting a tool run is the person's own call; Voice only says that one waits.
        actors: PERSON,
        input: z.object({
            chatId: chatTarget,
            requestId: z.string().min(1),
            decision: z.enum(['allow', 'allow-always', 'deny']),
            message: z.string().nullable().describe('Why it was denied, for the agent')
        }),
        output: chatNamed.extend({ requestId: z.string() })
    },
    'terminal.stop': {
        title: 'Stop terminal session',
        description:
            'Ends the shell of a terminal and everything running in it, after confirmation. The node stays and offers a restart; the scrollback and the agent session to resume are gone.',
        effect: 'external',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({ terminalId: terminalTarget }),
        output: terminalNamed
    },
    'terminal.resumeAgent': {
        title: 'Resume terminal agent',
        description:
            'Starts the agent CLI that ran in a terminal again on its own session, when it went down without ending: in the same shell while that runs, in a fresh one when the shell ended with it.',
        effect: 'external',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({ terminalId: terminalTarget }),
        output: terminalNamed
    },
    'terminal.restart': {
        title: 'Restart terminal',
        description:
            'Starts a fresh shell in a terminal whose shell ended, running the command the terminal was made with again. Its scrollback starts empty; resuming an agent session is terminal.resumeAgent.',
        effect: 'external',
        domain: 'sessions',
        actors: PERSON_AND_VOICE,
        input: z.object({ terminalId: terminalTarget }),
        output: terminalNamed
    }
} as const;
