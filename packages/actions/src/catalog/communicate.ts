import {
    ChatVisualSchema,
    VisualLayoutSchema,
    ChatVisualsSchema,
    ChatSubagentSourceSchema,
    ContextSourceSchema,
    ChatAttachmentUploadsSchema,
    ChatDeliverySchema,
    ChatQuoteSourceSchema,
    ChatSendResultSchema,
    ChatUiChoicePayloadSchema
} from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_TERMINAL_READ_LINES } from '../limits.ts';
import { PERSON_AND_VOICE, AGENT, PERSON, nodeId, forActors, CLIENT_ACTORS, operatedView, chatReadUsage, terminalTarget, terminalNamed } from './fields.ts';

export const COMMUNICATE_ACTIONS = {
    'visual.write': {
        title: 'Save visual source',
        description:
            "Saves or replaces an HTML source file in this chat's private visual folder, outside the project, and returns its absolute path. It does not publish the page.",
        effect: 'shared',
        domain: 'communicate',
        actors: AGENT,
        input: z.object({
            name: z.string().describe('An HTML filename such as chart.html, without a directory'),
            html: z.string().describe('The page, one self-contained HTML document')
        }),
        output: z.object({ path: z.string() })
    },
    /* The store checks a page and its title and refuses under its own codes, which an input schema would turn into one invalid-input. */
    'visual.show': {
        title: 'Show a visual',
        description: 'Shows a self-contained HTML page above your reply in this chat, such as a chart, a table, a diagram, a collage of images or a mockup.',
        effect: 'shared',
        domain: 'communicate',
        actors: AGENT,
        input: z.object({
            title: z.string().describe('What the page shows, in a few words'),
            html: z.string().describe('The page, one self-contained HTML document'),
            maxHeight: z.number().nullable().describe('The tallest the frame may grow, in CSS pixels; without it the most a frame may take'),
            layout: VisualLayoutSchema.optional().describe(
                'inline follows the reply column (default); wide uses the available chat pane for app mockups and dashboards'
            )
        }),
        output: z.object({ visual: ChatVisualSchema })
    },
    'visual.preview': {
        title: 'Preview a visual',
        description:
            'Renders a self-contained HTML page the way this chat would draw it, without showing it, and answers a png of it, the height it needs and what it wrote to its console.',
        effect: 'read',
        domain: 'communicate',
        actors: AGENT,
        input: z.object({
            html: z.string().describe('The page, one self-contained HTML document'),
            width: z.number().nullable().describe('The width of the frame in CSS pixels; without it the reply column of a chat at a common size'),
            appearance: z.enum(['dark', 'light']).nullable().describe('The appearance the page is drawn in; dark without it')
        }),
        output: z.object({
            // A png on this machine, outside the project folder.
            path: z.string(),
            width: z.number(),
            height: z.number(),
            // Less than `height` when the page is taller than a png of a preview gets.
            shotHeight: z.number(),
            console: z.array(z.object({ level: z.enum(['log', 'info', 'warning', 'error', 'exception']), text: z.string() })),
            // The console messages past the ones `console` holds.
            omitted: z.number()
        })
    },
    'visual.list': {
        title: 'List visuals',
        description: 'Lists the visuals of this chat in the order they were shown.',
        effect: 'read',
        domain: 'communicate',
        actors: AGENT,
        input: z.object({}),
        output: z.object({ visuals: ChatVisualsSchema })
    },
    'visual.remove': {
        title: 'Remove a visual',
        description: 'Takes a visual of this chat out of its thread.',
        effect: 'shared',
        domain: 'communicate',
        actors: AGENT,
        input: z.object({ visualId: z.string().min(1).describe('The visual by id, as visual show or visual list printed it') }),
        output: z.object({ visualId: z.string(), title: z.string() })
    },
    /* The daemon checks the bytes and refuses under its own codes (attach-not-image, attach-too-large, attach-limit). */
    'chat.attach': {
        title: 'Attach an image or a model to this chat',
        description:
            'Makes an image or a 3D model of your own an attachment of this chat and answers its id, which Image, Gallery and Compare take as attachment for an image and Model for a model.',
        effect: 'shared',
        domain: 'communicate',
        actors: AGENT,
        input: z.object({
            name: z.string().trim().min(1).max(200).describe('What the file is called, such as shot.png or part.stl'),
            data: z.string().min(1).describe('The file bytes in base64; the daemon reads the type off them')
        }),
        output: z.object({ attachment: z.object({ id: z.string(), name: z.string(), mime: z.string(), size: z.number() }) })
    },
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
        actors: AGENT,
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
        actors: AGENT,
        input: z.object({ nodeId: nodeId.describe('The node to notify, by id'), text: z.string().min(1).describe('The message') }),
        output: z.object({
            nodeId,
            // Now when it was acted on as it arrived, waiting when it is held for the next turn of that node.
            at: z.enum(['now', 'waiting']),
            detail: z.string(),
            // What the node is called now, which a thread keeps showing once it is gone.
            title: z.string().optional()
        })
    }
} as const;
