import { AgentKindSchema, DeviceReferenceSchema, ProviderAccountIdSchema } from '@ruimte/contracts';
import { z } from 'zod';
import {
    PERSON_AND_VOICE,
    AGENT,
    PERSON,
    PERSON_VOICE_AGENT_AND_AUTOMATION,
    ActionViewKindSchema,
    CREATABLE_VIEW_KINDS,
    ActionCreatableViewKindSchema,
    ActionCanvasNodeKindSchema,
    viewId,
    viewName,
    nodeId,
    revision,
    givenName,
    forActors,
    agentField,
    PERSON_VIEW_KINDS,
    PERSON_VOICE_AND_AGENT,
    PERSON_AND_AGENT,
    resumedSession,
    flagColor
} from './fields.ts';

export const VIEWS_ACTIONS = {
    'view.focus': {
        title: 'Focus view',
        description: 'Shows an existing view in the client that initiated the action.',
        agentDescription: 'Shows a view to whoever has this project on screen; the project file is not touched.',
        effect: 'local',
        domain: 'views',
        actors: PERSON_VOICE_AGENT_AND_AUTOMATION,
        input: z.object({ viewId }),
        output: z.object({
            viewId,
            view: viewName,
            kind: ActionViewKindSchema,
            changed: z.boolean(),
            delivered: z.boolean().optional()
        })
    },
    'view.rename': {
        title: 'Rename view',
        description: 'Changes the shared visible name of an existing view without changing its identity.',
        agentDescription: 'Renames a view; nothing the view hosts renames over it again.',
        effect: 'shared',
        domain: 'views',
        actors: PERSON_VOICE_AGENT_AND_AUTOMATION,
        input: z.object({ viewId, name: givenName }),
        output: z.object({
            viewId,
            kind: ActionViewKindSchema,
            previousName: z.string(),
            name: viewName,
            changed: z.boolean()
        })
    },
    'view.create': {
        title: 'Create view',
        description:
            'Creates and focuses a new canvas, drawing, diagram, terminal, browser, AI Chat, file, database or design view, or adds a separator or subheader to the view list. A chat or terminal can run a specific agent CLI; a file view shows the file at a path, relative to the project folder or absolute; a database view shows one table of a database connection, as its rows or its structure; a design is an AI Chat that works on the HTML files of the folder at the path, relative to the project folder, and shows them beside its thread.',
        agentDescription: 'Adds a view to the sidebar, written down as yours.',
        effect: 'shared',
        domain: 'views',
        actors: PERSON_VOICE_AGENT_AND_AUTOMATION,
        input: z.object({
            kind: z.union([ActionCreatableViewKindSchema, z.enum(PERSON_VIEW_KINDS).meta({ actors: [...PERSON] })]),
            name: givenName.nullable(),
            url: z.string().trim().min(1).nullable().describe('An http or https address'),
            browserOwner: forActors(PERSON, z.string().min(1)).describe('The machine that owns a session browser'),
            command: z.string().trim().min(1).nullable(),
            path: z.string().trim().min(1).nullable().describe('The file the view shows, relative to the project folder or absolute'),
            provider: AgentKindSchema.nullable(),
            account: forActors(PERSON, ProviderAccountIdSchema).describe("The account of the provider's CLI on this machine"),
            after: agentField(viewId).describe('Puts the row right under this view; without it the row goes last'),
            device: forActors(PERSON, DeviceReferenceSchema).describe('The simulator or device a device view shows'),
            resume: resumedSession,
            cwd: forActors(PERSON, z.string().min(1)).describe('The directory the chat or terminal works in'),
            connection: z.string().min(1).nullish().describe('The database connection a database view shows, by id or name'),
            schema: z.string().min(1).nullish().describe('The schema of the table; without it the schema the connection starts in'),
            table: z.string().min(1).nullish().describe('The table or view a database view shows'),
            mode: z.enum(['data', 'structure']).nullish().describe('Whether a database view shows the rows or the structure of the table; without it the rows'),
            where: z.string().trim().min(1).nullish().describe('A filter on the rows, as the text after WHERE')
        }),
        output: z.object({
            viewId,
            view: viewName,
            kind: z.enum([...CREATABLE_VIEW_KINDS, ...PERSON_VIEW_KINDS])
        })
    },
    'view.delete': {
        title: 'Delete view',
        description: 'Deletes a view and everything it contains after confirmation, saving the files it shows with unsaved changes first.',
        agentDescription: 'Removes a view you made, with the sessions it holds.',
        effect: 'shared',
        domain: 'views',
        actors: PERSON_VOICE_AGENT_AND_AUTOMATION,
        input: z.object({ viewId }),
        output: z.object({
            viewId,
            // A separator has no name, and it is deleted like any other view.
            view: z.string(),
            kind: ActionViewKindSchema,
            ended: z.array(z.object({ nodeId, kind: z.enum(['terminal', 'chat']) })).optional(),
            nodes: z.array(z.object({ nodeId, kind: ActionCanvasNodeKindSchema, title: z.string() })).optional()
        })
    },
    'view.duplicate': {
        title: 'Duplicate view',
        description: 'Copies a canvas, drawing or diagram view with everything it holds. The copy goes right under it and is not opened.',
        effect: 'shared',
        domain: 'views',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId }),
        output: z.object({ sourceViewId: viewId, viewId, view: viewName, kind: ActionViewKindSchema })
    },
    'view.placeOnCanvas': {
        title: 'Place view on canvas',
        description:
            'Turns a chat, terminal, browser or device view into a node on a canvas, keeping its session, and shows that canvas. Without a canvas named it goes onto the canvas on screen, else the one that was open last.',
        effect: 'shared',
        domain: 'views',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId, canvasViewId: viewId.nullish().describe('The canvas view to place it on') }),
        output: z.object({ viewId, view: z.string(), canvasViewId: viewId, canvas: viewName })
    },
    'view.showOnCanvas': {
        title: 'Show view on canvas',
        description:
            'Puts a live mirror of a drawing or diagram view on the canvas on screen, else the one that was open last, and shows it there. The view itself stays.',
        effect: 'shared',
        domain: 'views',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId }),
        output: z.object({ viewId, view: viewName, canvasViewId: viewId, canvas: viewName, nodeId: z.string().min(1) })
    },
    'view.share': {
        title: 'Share view',
        description: "Moves a view into the project file a team commits, or back into this person's private file.",
        effect: 'shared',
        domain: 'views',
        // Nothing is shared until a person names it, so neither Voice nor an agent may move a view between the files.
        actors: PERSON,
        input: z.object({ viewId, shared: z.boolean() }),
        output: z.object({ viewId, view: z.string(), shared: z.boolean(), changed: z.boolean() })
    },
    'view.list': {
        title: 'List views',
        description: 'Lists the views of the project in sidebar order, with whether you may delete each and why.',
        effect: 'read',
        domain: 'views',
        actors: AGENT,
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
    }
} as const;
