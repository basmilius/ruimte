import {
    TerminalPrepareSourceSchema,
    TerminalPreparePreviewResultSchema,
    TerminalPrepareResultSchema,
    AgentKindSchema,
    AgentStatusSchema,
    ChatAttachmentUploadsSchema,
    ChatBackgroundTaskSchema,
    ChatCheckpointDiffSchema,
    ChatDeliverySchema,
    ChatExternalResultSchema,
    ChatQuoteSourceSchema,
    ChatSearchResultSchema,
    ChatSendResultSchema,
    ChatSubagentStatusSchema,
    ChatUiChoicePayloadSchema,
    ProviderAccountIdSchema,
    RuntimeModeSchema,
    TaskSchema
} from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_PER_CALL, MAX_TERMINAL_READ_LINES } from '../limits.ts';
import {
    ActionViewKindSchema,
    ActionCanvasNodeKindSchema,
    viewId,
    nodeId,
    revision,
    givenName,
    forActors,
    agentField,
    ARRANGE_LAYOUTS,
    PERSON_AND_VOICE,
    PERSON_VOICE_AND_AGENT,
    CLIENT_ACTORS,
    AGENT,
    PERSON,
    PERSON_AND_AGENT,
    chatTarget,
    terminalTarget,
    chatNamed,
    terminalNamed,
    queuedMessage,
    queuedMessageOutput,
    modelOptions,
    modelSelection,
    questionAnswers,
    recentMessages,
    flagColor,
    canvasLine
} from './fields.ts';

export const SESSION_ACTIONS = {
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
    'terminal.clear': {
        title: 'Clear terminal',
        description: 'Clears the screen and scrollback of a terminal view or node, after confirmation. The process in it keeps running.',
        effect: 'external',
        domain: 'communicate',
        // An agent never types into or clears the session of another node.
        actors: PERSON_AND_VOICE,
        input: z.object({ terminalId: z.string().min(1) }),
        output: z.object({ terminalId: z.string().min(1), terminal: z.string() })
    },
    'chat.send': {
        title: 'Send AI Chat prompt',
        description: 'Submits a direct prompt to an existing AI Chat view or node.',
        effect: 'external',
        domain: 'communicate',
        actors: CLIENT_ACTORS,
        input: z.object({
            chatId: z.string().min(1),
            // Not trimmed here: the composer sends what was typed, and a message of attachments alone has no text.
            prompt: z.string(),
            delivery: forActors(PERSON_AND_VOICE, ChatDeliverySchema).describe('Steer the running agent, or queue until its current turn finishes'),
            mentions: forActors(PERSON, z.array(z.string().min(1)).max(64)).describe('Paths picked with @'),
            skills: forActors(PERSON, z.array(z.string().min(1)).max(16)).describe('Skills picked with $'),
            chats: forActors(PERSON, z.array(z.string().min(1)).max(16)).describe('Chats of this project picked with #'),
            quoteSource: forActors(PERSON, ChatQuoteSourceSchema).describe('The reply a quote at the head of the prompt was taken from'),
            attachments: forActors(PERSON, ChatAttachmentUploadsSchema).describe('Files dropped or pasted into the composer'),
            references: forActors(PERSON, z.array(z.string().min(1)).max(16)).describe('Views and nodes of this project picked with #')
        }),
        output: z.object({
            chatId: z.string().min(1),
            chat: z.string(),
            queued: z.boolean(),
            turnId: z.string().min(1).optional()
        })
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
    'chat.uiChoice': {
        title: 'Send AI Chat choice',
        description: 'Sends a choice from a completed reply using its stored label and visible context.',
        effect: 'external',
        domain: 'communicate',
        actors: PERSON,
        input: ChatUiChoicePayloadSchema,
        output: ChatSendResultSchema
    },
    'chat.clear': {
        title: 'Clear AI Chat',
        description: 'Clears conversation history, attachments and plans, and stops the current turn after confirmation. Keeps the chat node or view.',
        effect: 'external',
        domain: 'communicate',
        actors: PERSON_AND_VOICE,
        input: z.object({
            chatId: z.string().min(1),
            // The composer clears without it first, so a turn in the way comes back as chat-busy and the person is asked.
            force: forActors(PERSON, z.boolean()).describe('Stops a running turn instead of refusing')
        }),
        output: z.object({ chatId: z.string().min(1), chat: z.string() })
    },
    'chat.read': {
        title: 'Read recent AI Chat messages',
        description:
            'Reads a limited recent excerpt of an AI Chat of this project, also one nobody opened in this window, without including reasoning or tool output. A null limit reads the last 20 messages.',
        effect: 'read',
        domain: 'communicate',
        actors: CLIENT_ACTORS,
        input: z.object({ chatId: z.string().min(1), limit: z.number().int().min(1).max(20).nullable() }),
        output: z.object({
            chatId: z.string().min(1),
            chat: z.string(),
            messages: z.array(
                z.object({
                    role: z.enum(['user', 'assistant']),
                    text: z.string(),
                    createdAt: z.number()
                })
            ),
            truncated: z.boolean()
        })
    },
    'terminal.read': {
        title: 'Read terminal output',
        description: 'Reads the last lines on the screen and in the scrollback of a terminal that is open in this window. A null lines reads the last 40.',
        effect: 'read',
        domain: 'communicate',
        actors: PERSON_AND_VOICE,
        input: z.object({ terminalId: terminalTarget, lines: z.number().int().min(1).max(MAX_TERMINAL_READ_LINES).nullable() }),
        output: terminalNamed.extend({ lines: z.array(z.string()), truncated: z.boolean(), exited: z.boolean() })
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
    },
    'view.list': {
        title: 'List views',
        description: 'Lists the views of the project in sidebar order, with whether you may delete each and why.',
        effect: 'read',
        domain: 'views',
        actors: PERSON_AND_AGENT,
        input: z.object({}),
        output: z.object({
            views: z.array(
                z.object({
                    viewId,
                    kind: ActionViewKindSchema,
                    name: z.string(),
                    deletable: z.boolean(),
                    why: z.string(),
                    // The Lucide name of the mark view icon gave it; null for a view that wears the mark of its kind.
                    icon: z.string().nullable(),
                    flag: flagColor.nullable()
                })
            ),
            // The view the caller is in: the canvas it is a node on, or its own id when it is a view.
            self: z.string(),
            // Of the project file.
            revision
        })
    },
    'view.setIcon': {
        title: 'Mark view',
        description: 'Gives a view a mark of its own from the Lucide names the picker has, or takes its mark away with null.',
        effect: 'shared',
        domain: 'views',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({ viewId, icon: z.string().min(1).nullable().describe('A Lucide name from the set the picker has') }),
        output: z.object({ viewId, kind: ActionViewKindSchema, icon: z.object({ kind: z.literal('lucide'), value: z.string() }).nullable() })
    },
    'view.move': {
        title: 'Move view',
        description: 'Moves a view to another place in the sidebar.',
        effect: 'shared',
        domain: 'views',
        actors: PERSON_AND_AGENT,
        input: z.object({ viewId, afterViewId: viewId.nullable().describe('The view it goes right under; without one it goes to the top') }),
        output: z.object({ viewId, kind: ActionViewKindSchema, index: z.number().int() })
    },
    'node.list': {
        title: 'List canvas nodes',
        description: 'Lists the nodes of a canvas, where each stands and the group it is in.',
        effect: 'read',
        domain: 'canvas',
        actors: PERSON_AND_AGENT,
        input: z.object({ viewId }),
        output: z.object({
            viewId,
            nodes: z.array(
                z.object({
                    nodeId,
                    kind: ActionCanvasNodeKindSchema,
                    title: z.string(),
                    x: z.number(),
                    y: z.number(),
                    w: z.number(),
                    h: z.number(),
                    groupId: z.string().nullable(),
                    flag: flagColor.nullable(),
                    snoozedUntil: z.iso.datetime().nullable().describe('When the snooze a person put on the node ends; null for none')
                })
            ),
            // The caller when it is one of these nodes.
            self: z.string().nullable(),
            // Of the project file.
            revision
        })
    },
    'node.update': {
        title: 'Write in a note',
        description: 'Writes the body of a note on a canvas on screen; append puts the text under what is there instead of over it.',
        agentDescription:
            'Writes the body of a note you made or a line joins you to, or any note of the canvas a chat view names; append puts the text under what is there instead of over it.',
        effect: 'shared',
        domain: 'content',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({
            viewId,
            nodeId,
            text: z.string().describe('What to write'),
            append: z.boolean().describe('Adds the text as a line under what is there instead of replacing the body')
        }),
        output: z.object({ viewId, nodeId, lines: z.number().int(), characters: z.number().int(), changed: z.boolean() })
    },
    'node.updateMany': {
        title: 'Write in notes',
        description:
            'Writes the bodies of several notes of one canvas in one write, each the way node.update writes one. Every note is checked before any is written, so a refusal writes none.',
        agentDescription: 'Writes in several notes in one write, each a note you made or a line joins you to, or any note of the canvas a chat view names.',
        effect: 'shared',
        domain: 'content',
        actors: PERSON_AND_AGENT,
        input: z.object({
            viewId,
            nodes: z
                .array(
                    z.object({
                        nodeId,
                        text: z.string().describe('What to write'),
                        append: z.boolean().describe('Adds the text as a line under what is there instead of replacing the body')
                    })
                )
                .min(1)
                .max(MAX_PER_CALL)
        }),
        output: z.object({
            viewId,
            nodes: z.array(z.object({ nodeId, lines: z.number().int(), characters: z.number().int(), changed: z.boolean() }))
        })
    },
    'flag.set': {
        title: 'Flag',
        description: 'Puts a colored flag on views and nodes, or takes it off with null. A flag is personal: it never goes into the shared project file.',
        effect: 'shared',
        domain: 'views',
        actors: PERSON_AND_AGENT,
        input: z.object({
            ids: z.array(z.string().min(1)).min(1).describe('The views and nodes to flag, by id'),
            color: flagColor.nullable().describe('The color of the flag; null takes it off')
        }),
        output: z.object({
            flags: z.array(z.object({ id: z.string(), target: z.enum(['view', 'node']), previous: flagColor.nullable() })),
            color: flagColor.nullable(),
            changed: z.boolean()
        })
    },
    'node.arrange': {
        title: 'Arrange canvas nodes',
        description: 'Lays nodes out in a grid, a row or a column without overlap.',
        effect: 'shared',
        domain: 'canvas',
        actors: PERSON_AND_AGENT,
        input: z.object({
            viewId,
            nodeIds: z.array(nodeId).min(1).describe('The nodes to tidy; they are laid out in the order they are named'),
            layout: z.enum(ARRANGE_LAYOUTS),
            columns: z
                .number()
                .int()
                .min(1)
                .nullable()
                .describe('How many columns the grid gets; without it as square as the count allows, so 5 nodes are 3 and 2')
        }),
        output: z.object({ viewId, nodes: z.array(z.object({ nodeId, x: z.number(), y: z.number() })), changed: z.boolean() })
    },
    'link.list': {
        title: 'List canvas lines',
        description: 'Lists the lines of a canvas.',
        effect: 'read',
        domain: 'canvas',
        actors: PERSON_AND_AGENT,
        input: z.object({ viewId }),
        // The revision is that of the project file.
        output: z.object({ viewId, edges: z.array(canvasLine), revision })
    },
    'link.create': {
        title: 'Draw canvas lines',
        description: 'Draws a context line between nodes of one canvas; between two agents it draws both ways.',
        effect: 'shared',
        domain: 'canvas',
        actors: PERSON_AND_AGENT,
        input: z.object({
            viewId,
            from: nodeId.nullable().describe('Where the line starts; without it, you'),
            to: z.array(nodeId).min(1).describe('The nodes the line runs into'),
            label: agentField(givenName).describe('What the line is called on the canvas'),
            role: agentField(z.string().min(1)).describe('What the line is for')
        }),
        output: z.object({
            viewId,
            edges: z.array(
                z.object({
                    edgeId: z.string(),
                    from: nodeId,
                    to: nodeId,
                    state: z.enum(['new', 'updated', 'existing']),
                    // Out for the line asked for, back for the one drawn the other way between two agents.
                    way: z.enum(['out', 'back'])
                })
            )
        })
    },
    'link.delete': {
        title: 'Remove canvas line',
        description: 'Removes one line whose ends are both yours.',
        effect: 'shared',
        domain: 'canvas',
        actors: PERSON_AND_AGENT,
        input: z.object({ viewId, edgeId: z.string().min(1) }),
        output: z.object({ viewId, ...canvasLine.shape })
    },
    'link.deleteMany': {
        title: 'Remove canvas lines',
        description:
            'Removes several lines of one canvas in one write, each the way link.delete removes one. Every line is checked before any goes, so a refusal removes none.',
        effect: 'shared',
        domain: 'canvas',
        actors: PERSON_AND_AGENT,
        input: z.object({ viewId, edgeIds: z.array(z.string().min(1)).min(1).max(MAX_PER_CALL) }),
        output: z.object({ viewId, edges: z.array(canvasLine) })
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
    'agent.alert': {
        title: 'Notify the person',
        description: 'Sends the person a notification from your own session. Use only when they asked for one, such as when your work is done.',
        effect: 'external',
        domain: 'communicate',
        actors: AGENT,
        input: z.object({ text: z.string().trim().min(1).max(500).describe('The notification message') }),
        output: z.object({ nodeId })
    },
    'agent.notify': {
        title: 'Notify an agent',
        description: 'Sends a message to the agent in another node, along a line that runs from you into it, which gives a chat between turns a turn on it.',
        effect: 'external',
        domain: 'communicate',
        actors: PERSON_AND_AGENT,
        input: z.object({ nodeId: nodeId.describe('The node to notify, by id'), text: z.string().min(1).describe('The message') }),
        output: z.object({
            nodeId,
            // Now when it was acted on as it arrived, waiting when it is held for the next turn of that node.
            at: z.enum(['now', 'waiting']),
            detail: z.string(),
            // What the node is called now, which a thread keeps showing once it is gone.
            title: z.string().optional()
        })
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
    }
} as const;
