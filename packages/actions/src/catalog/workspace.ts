import {
    ArtifactIdSchema,
    ArtifactVersionIdSchema,
    AgentKindSchema,
    AgentStatusSchema,
    ChatMoveTargetSchema,
    DeviceReferenceSchema,
    NODE_ACCENT_NAMES,
    PROJECT_PROPOSAL_LIMITS,
    ProviderAccountIdSchema
} from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_PER_CALL } from '../limits.ts';
import {
    ACTION_ACTOR_KINDS,
    ActionViewKindSchema,
    CREATABLE_VIEW_KINDS,
    ActionCreatableViewKindSchema,
    ActionCanvasNodeKindSchema,
    ActionCreatableCanvasNodeKindSchema,
    viewId,
    viewName,
    nodeId,
    revision,
    givenName,
    forActors,
    daemonField,
    AGENT_NODE_KINDS,
    OUTPUT_NODE_KINDS,
    PERSON_VIEW_KINDS,
    worldPoint,
    LOCK_GESTURES,
    PERSON_AND_VOICE,
    PERSON_VOICE_AND_AGENT,
    CLIENT_ACTORS,
    AGENT,
    PERSON,
    PERSON_AND_AGENT,
    resumedSession,
    chatTarget,
    filePath,
    drawnLine,
    routineId,
    projectMachine,
    listedProjectId,
    TARGET_KINDS,
    resolvedTarget
} from './fields.ts';

export const WORKSPACE_ACTIONS = {
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
    'project.list': {
        title: 'List projects',
        description: 'Lists the projects of every machine this window knows: the ones in use, and the ones under Recent that a person closed.',
        effect: 'read',
        domain: 'projects',
        actors: CLIENT_ACTORS,
        input: z.object({}),
        output: z.object({
            projects: z.array(
                z.object({
                    endpointId: z.string(),
                    projectId: z.string(),
                    name: z.string(),
                    machine: z.string(),
                    folder: z.string(),
                    recent: z.boolean(),
                    active: z.boolean(),
                    available: z.boolean()
                })
            )
        })
    },
    'project.switch': {
        title: 'Open project',
        description: 'Shows a project of the list in this window. One under Recent comes back into use.',
        effect: 'local',
        domain: 'projects',
        actors: PERSON_AND_VOICE,
        input: z.object({ endpointId: projectMachine, projectId: listedProjectId }),
        output: z.object({ project: z.string(), endpointId: z.string(), projectId: z.string() })
    },
    'project.close': {
        title: 'Close project',
        description:
            'Puts a project of the list under Recent in this window, after confirmation. Its sessions end only when no other client still has it open; the confirmation says which.',
        effect: 'shared',
        domain: 'projects',
        actors: PERSON_AND_VOICE,
        input: z.object({ endpointId: projectMachine, projectId: listedProjectId }),
        output: z.object({
            project: z.string(),
            endpointId: z.string(),
            projectId: z.string(),
            // Null when the machine could not be asked, so only this window let go of it.
            sessions: z.number().int().nullable(),
            otherClients: z.number().int().nullable()
        })
    },
    'project.create': {
        title: 'Open folder as project',
        description: 'Opens a folder on a machine as a project in this window, and makes the folder first when asked to.',
        effect: 'shared',
        domain: 'projects',
        actors: PERSON,
        input: z.object({
            endpointId: projectMachine,
            folder: z.string().min(1).describe('An absolute path on that machine'),
            createFolder: z.boolean().nullable()
        }),
        output: z.object({ project: z.string(), endpointId: z.string(), folder: z.string() })
    },
    'chat.move': {
        title: 'Move AI Chat out of Chats',
        description:
            'Moves an AI Chat of the Chats project into a project on its machine: one that is in the list, or a new one made in a folder. The chat keeps its conversation and works in the project folder from its next turn. Refused while it works, or while it has agents, tasks, owed work, waiting messages or a pull request watch.',
        effect: 'shared',
        domain: 'projects',
        actors: PERSON,
        input: z.object({
            endpointId: projectMachine,
            chatId: chatTarget,
            to: ChatMoveTargetSchema.describe('A project of the list by projectId, or a folder with the name of the project to make there'),
            ownFiles: z.enum(['move', 'leave']).describe('Whether the files the chat made in its own folder move into the project or stay in Chats')
        }),
        output: z.object({ project: z.string(), projectId: z.string(), viewId: z.string() })
    },
    'project.propose': {
        title: 'Suggest a project',
        description:
            "Suggests, in a card of the caller's chat in Chats, that the chat becomes a project; the person reviews it and decides. Makes nothing itself.",
        effect: 'external',
        domain: 'projects',
        actors: AGENT,
        input: z.object({
            name: z.string().trim().min(1).max(PROJECT_PROPOSAL_LIMITS.name).describe('The name of the project, such as the product or the repository'),
            folder: z
                .string()
                .trim()
                .min(1)
                .max(PROJECT_PROPOSAL_LIMITS.folder)
                .nullish()
                .describe('An absolute folder on this machine the project would live in; the person picks one when it is left out'),
            reason: z.string().trim().min(1).max(PROJECT_PROPOSAL_LIMITS.reason).describe('Why the work is a project now, in one or two sentences')
        }),
        output: z.object({
            proposalId: z.string(),
            outcome: z.enum(['declined', 'waiting'])
        })
    },
    'project.ignoredFiles': {
        title: 'List the ignored files of the project',
        description:
            'Lists the files git ignores in the repository of the project (.env files, local settings), which a clone elsewhere does not bring. A folder ignored whole, such as node_modules, is left out.',
        agentDescription: 'Lists the files git ignores in the project repository: path, size, link; folders ignored whole are left out',
        effect: 'read',
        domain: 'projects',
        actors: AGENT,
        input: z.object({}),
        output: z.object({
            // The repository's top level, which every path is relative to.
            root: z.string(),
            files: z.array(z.object({ path: z.string(), size: z.number().int(), link: z.boolean() })),
            truncated: z.boolean()
        })
    },
    'project.delete': {
        title: 'Delete project',
        description: 'Removes a project from its machine after confirmation. A folder keeps every file but, when asked, its canvas file.',
        effect: 'shared',
        domain: 'projects',
        actors: PERSON,
        input: z.object({ endpointId: projectMachine, projectId: listedProjectId, removeFiles: z.boolean().nullable() }),
        output: z.object({ project: z.string(), endpointId: z.string(), projectId: z.string() })
    },
    'project.setAppearance': {
        title: 'Change project name, icon or color',
        description:
            'Renames a project of the list, gives it a Lucide icon from the set the picker has (or folder for what the folder itself declares), or a color. The color is in the shared project file, so a team sees it.',
        effect: 'shared',
        domain: 'projects',
        actors: PERSON_AND_VOICE,
        input: z.object({
            endpointId: projectMachine,
            projectId: listedProjectId,
            name: givenName.nullable(),
            icon: z.string().min(1).nullable().describe('A Lucide name, folder for what the folder itself declares, or none to clear a picked icon'),
            image: forActors(PERSON, z.object({ mime: z.string().min(1), base64: z.string().min(1) })).describe(
                'An image the icon becomes, written into the folder'
            ),
            color: z
                .string()
                .regex(/^#[0-9a-fA-F]{6}$/)
                .nullable()
                .describe('The color of the project as #rrggbb')
        }),
        output: z.object({ project: z.string(), endpointId: z.string(), projectId: z.string(), icon: z.string() })
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
    'workspace.inspect': {
        title: 'Inspect workspace',
        description: 'Reads the current project, active view, openable views, the cells of the split grid on screen, active canvas nodes and selection.',
        effect: 'read',
        domain: 'workspace',
        actors: CLIENT_ACTORS,
        input: z.object({}),
        output: z.object({
            project: z.string(),
            // Of the project file, as this window last saved or read it.
            revision,
            activeView: z
                .object({
                    id: viewId,
                    name: z.string(),
                    kind: ActionViewKindSchema
                })
                .nullable(),
            views: z.array(
                z.object({
                    id: viewId,
                    name: z.string(),
                    kind: ActionViewKindSchema
                })
            ),
            // Column by column, top to bottom; a cell is named by the view standing in it.
            cells: z.array(z.object({ viewId, view: z.string(), column: z.number().int(), cell: z.number().int(), focused: z.boolean() })),
            canvas: z
                .object({
                    viewId,
                    nodes: z.array(
                        z.object({
                            id: z.string().min(1),
                            title: z.string(),
                            kind: ActionCanvasNodeKindSchema,
                            visible: z.boolean(),
                            // What a chat or terminal agent does, where the machine answers rather than a window.
                            status: z.union([AgentStatusSchema, z.literal('unknown')]).optional()
                        })
                    ),
                    selected: z.array(
                        z.object({
                            id: z.string().min(1),
                            title: z.string(),
                            kind: ActionCanvasNodeKindSchema
                        })
                    )
                })
                .nullable(),
            /*
             * What this answer cannot know, so an empty list there reads as unknown and never as empty: the
             * machine answers for a phone, which has no split cells or selection and does not say what is in sight.
             */
            unknown: z.array(z.enum(['cells', 'selection', 'visible'])).optional()
        })
    },
    'target.resolve': {
        title: 'Resolve names',
        description:
            'Turns spoken or typed names of views, nodes on the active canvas, AI Chats, agents or projects (a project in use before one under Recent) into ids. A name that fits more than one comes back under ambiguous with every candidate, never as the first of them. Without names it returns the current ones: the active view, the nodes in scope (the selection unless a scope is given), the active or selected AI Chat, the selected agent or the active project. Scope and nodeKind narrow nodes, machine narrows projects.',
        effect: 'read',
        domain: 'workspace',
        actors: PERSON_AND_VOICE,
        input: z.object({
            target: z.enum(TARGET_KINDS),
            names: z.array(z.string().trim().min(1)).min(1).nullable(),
            nodeKind: ActionCanvasNodeKindSchema.nullable(),
            scope: z.enum(['selected', 'visible', 'all']).nullable(),
            machine: z.string().trim().min(1).nullable()
        }),
        output: z.object({
            target: z.enum(TARGET_KINDS),
            found: z.array(resolvedTarget),
            ambiguous: z.array(z.object({ name: z.string(), candidates: z.array(resolvedTarget) })),
            missing: z.array(z.string())
        })
    },
    'view.focus': {
        title: 'Focus view',
        description: 'Shows an existing view in the client that initiated the action.',
        agentDescription: 'Shows a view to whoever has this project on screen; the project file is not touched.',
        effect: 'local',
        domain: 'views',
        actors: ACTION_ACTOR_KINDS,
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
        actors: ACTION_ACTOR_KINDS,
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
        actors: ACTION_ACTOR_KINDS,
        input: z.object({
            kind: z.union([ActionCreatableViewKindSchema, z.enum(PERSON_VIEW_KINDS).meta({ actors: [...PERSON] })]),
            name: givenName.nullable(),
            url: z.string().trim().min(1).nullable().describe('An http or https address'),
            browserOwner: forActors(PERSON, z.string().min(1)).describe('The machine that owns a session browser'),
            command: z.string().trim().min(1).nullable(),
            path: z.string().trim().min(1).nullable().describe('The file the view shows, relative to the project folder or absolute'),
            provider: AgentKindSchema.nullable(),
            account: forActors(PERSON, ProviderAccountIdSchema).describe("The account of the provider's CLI on this machine"),
            after: daemonField(viewId).describe('Puts the row right under this view; without it the row goes last'),
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
        actors: ACTION_ACTOR_KINDS,
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
    'node.focus': {
        title: 'Focus canvas node',
        description: 'Selects and brings a node on the active canvas into view.',
        effect: 'local',
        domain: 'canvas',
        actors: CLIENT_ACTORS,
        input: z.object({ viewId, nodeId: z.string().min(1) }),
        output: z.object({
            viewId,
            view: viewName,
            nodeId: z.string().min(1),
            node: z.string(),
            kind: ActionCanvasNodeKindSchema
        })
    },
    'node.rename': {
        title: 'Rename canvas node',
        description: 'Changes the shared visible title of a node on the active canvas.',
        agentDescription: 'Renames one node; nothing the node hosts renames over it again.',
        effect: 'shared',
        domain: 'canvas',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({ viewId, nodeId: z.string().min(1), name: givenName }),
        output: z.object({
            viewId,
            nodeId: z.string().min(1),
            kind: ActionCanvasNodeKindSchema,
            previousName: z.string(),
            name: viewName,
            changed: z.boolean()
        })
    },
    'node.renameMany': {
        title: 'Rename canvas nodes',
        description:
            'Renames several nodes of one canvas in one write, each the way node.rename renames one. Every node is checked before any is renamed, so a refusal renames none.',
        agentDescription: 'Renames several nodes in one write; nothing a node hosts renames over its new title again.',
        effect: 'shared',
        domain: 'canvas',
        actors: AGENT,
        input: z.object({
            viewId,
            nodes: z
                .array(z.object({ nodeId: z.string().min(1), name: givenName }))
                .min(1)
                .max(MAX_PER_CALL)
        }),
        output: z.object({
            viewId,
            nodes: z.array(
                z.object({ nodeId: z.string().min(1), kind: ActionCanvasNodeKindSchema, previousName: z.string(), name: viewName, changed: z.boolean() })
            )
        })
    },
    'node.setColor': {
        title: 'Color canvas node',
        description: 'Gives a node on a canvas one of the colors, or takes its color off with null. A note takes its paper from it.',
        agentDescription: 'Colors one node you made or have a line with; a note takes its paper from the color.',
        effect: 'shared',
        domain: 'canvas',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({
            viewId,
            nodeId: nodeId.describe('The node, by id'),
            color: z.enum(NODE_ACCENT_NAMES).nullable().describe('The color; null takes it off')
        }),
        output: z.object({
            viewId,
            nodeId,
            kind: ActionCanvasNodeKindSchema,
            color: z.enum(NODE_ACCENT_NAMES).nullable(),
            // What the node showed before: a note's paper, which may be the neutral one of an old gray note.
            previousColor: z.string().nullable(),
            changed: z.boolean()
        })
    },
    'node.create': {
        title: 'Create canvas node',
        description:
            'Creates a node on the active canvas, centered on a world position or in free space near the middle of the screen. A chat or terminal can run a specific agent CLI; a file node shows the file at a path, relative to the project folder or absolute, read-only.',
        agentDescription: 'Adds one node to a canvas, with a line from you into it.',
        effect: 'shared',
        domain: 'canvas',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({
            viewId,
            kind: z.union([
                ActionCreatableCanvasNodeKindSchema,
                z.enum(AGENT_NODE_KINDS).meta({ actors: [...PERSON_AND_AGENT] }),
                z.enum(OUTPUT_NODE_KINDS).meta({ actors: [...PERSON_AND_AGENT] })
            ]),
            title: givenName.nullable(),
            content: z.string().nullable().describe('The body of a note'),
            url: z.string().trim().min(1).nullable().describe('An http or https address'),
            browserOwner: forActors(PERSON, z.string().min(1)).describe('The machine that owns a session browser'),
            command: z.string().trim().min(1).nullable(),
            path: z.string().trim().min(1).nullable().describe('The file the node shows, relative to the project folder or absolute'),
            provider: AgentKindSchema.nullable(),
            // An agent's children inherit their account from it and never pick one.
            account: forActors(PERSON, ProviderAccountIdSchema).describe(
                "The account of the provider's CLI on this machine. With a command, a terminal runs that command in the account's environment instead of the CLI"
            ),
            at: worldPoint.nullable(),
            source: daemonField(viewId).describe(
                'The id of a view of this project of the same kind as the node, a drawing for a drawing and a diagram for a diagram'
            ),
            cwd: forActors(PERSON_AND_AGENT, z.string().min(1)).describe('The directory the shell starts in'),
            beside: daemonField(nodeId).describe('Puts the node directly right of this node, top edges level, whatever is there already'),
            device: daemonField(z.string().min(1)).describe('The device a device node shows, by the id device.list gives it'),
            resume: resumedSession,
            issue: forActors(PERSON, z.object({ repo: z.string().min(1), number: z.number().int().positive(), url: z.string().min(1) })).describe(
                'The GitHub issue an agent node is started on, which the node shows as a pill'
            ),
            color: daemonField(z.enum(NODE_ACCENT_NAMES)).describe('The color of the node; a note takes its paper from it'),
            artifact: forActors(PERSON_AND_AGENT, ArtifactIdSchema).describe("The artifact of this project's Output an artifact node shows"),
            artifactVersion: forActors(PERSON_AND_AGENT, ArtifactVersionIdSchema).describe(
                'The version an artifact node stays on; without it the node follows the latest'
            ),
            routine: forActors(PERSON_AND_AGENT, routineId).describe('The routine of this project a routine node shows')
        }),
        output: z.object({
            viewId,
            view: viewName,
            nodeId: z.string().min(1),
            node: z.string(),
            kind: ActionCanvasNodeKindSchema,
            // The line drawn from the agent into what it made.
            edge: drawnLine.nullable().optional()
        })
    },
    'node.createMany': {
        title: 'Create canvas nodes',
        description:
            'Creates several nodes on one canvas in one write, each the way node.create makes one, with a line from the caller into each. Every node is checked before any is made, so a refusal makes none.',
        agentDescription: 'Adds several nodes to a canvas in one write, with a line from you into each.',
        effect: 'shared',
        domain: 'canvas',
        actors: AGENT,
        input: z.object({
            viewId,
            nodes: z
                .array(
                    z.object({
                        kind: z.union([ActionCreatableCanvasNodeKindSchema, z.enum(AGENT_NODE_KINDS)]),
                        title: givenName.nullable(),
                        content: z.string().nullable().describe('The body of a note'),
                        url: z.string().trim().min(1).nullable().describe('An http or https address'),
                        path: z.string().trim().min(1).nullable().describe('The file the node shows, relative to the project folder or absolute'),
                        source: viewId.nullable().describe('The id of a view of this project of the same kind as the node'),
                        cwd: z.string().min(1).nullable().describe('The directory the shell starts in'),
                        beside: nodeId.nullable().describe('Puts the node directly right of this node, top edges level'),
                        device: z.string().min(1).nullable().describe('The device a device node shows'),
                        color: z.enum(NODE_ACCENT_NAMES).nullable().describe('The color of the node; a note takes its paper from it')
                    })
                )
                .min(1)
                .max(MAX_PER_CALL)
        }),
        output: z.object({
            viewId,
            view: viewName,
            nodes: z.array(
                z.object({
                    nodeId: z.string().min(1),
                    node: z.string(),
                    kind: ActionCanvasNodeKindSchema,
                    edge: drawnLine.nullable()
                })
            )
        })
    },
    'node.duplicate': {
        title: 'Duplicate canvas node',
        description: 'Duplicates one node on the active canvas and selects the copy.',
        effect: 'shared',
        domain: 'canvas',
        actors: CLIENT_ACTORS,
        input: z.object({ viewId, nodeId: z.string().min(1) }),
        output: z.object({
            viewId,
            view: viewName,
            sourceNodeId: z.string().min(1),
            nodeId: z.string().min(1),
            node: z.string(),
            kind: ActionCanvasNodeKindSchema
        })
    },
    'canvas.select': {
        title: 'Select canvas nodes',
        description: 'Replaces the active canvas selection with specific nodes and text elements, all named in nodeIds.',
        effect: 'local',
        domain: 'canvas',
        actors: CLIENT_ACTORS,
        input: z.object({ viewId, nodeIds: z.array(z.string().min(1)).min(1) }),
        output: z.object({
            viewId,
            view: viewName,
            nodeIds: z.array(z.string().min(1)),
            // A text element reads as its text.
            nodes: z.array(z.string())
        })
    },
    'node.delete': {
        title: 'Delete canvas nodes',
        description: 'Deletes one or more nodes from the active canvas after confirmation.',
        agentDescription: 'Removes a node you made, with the session it holds and the lines that ran into it.',
        effect: 'shared',
        domain: 'canvas',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({ viewId, nodeIds: z.array(z.string().min(1)).min(1) }),
        output: z.object({
            viewId,
            view: viewName,
            nodeIds: z.array(z.string().min(1)),
            nodes: z.array(z.string()),
            removed: z
                .array(
                    z.object({
                        nodeId,
                        kind: ActionCanvasNodeKindSchema,
                        title: z.string(),
                        ended: z.boolean(),
                        edges: z.number().int(),
                        // Only a group has members, and they stay where they stand.
                        members: z.number().int().nullable()
                    })
                )
                .optional()
        })
    },
    'group.create': {
        title: 'Group canvas nodes',
        description: 'Creates a group frame around one or more nodes on the active canvas.',
        agentDescription: 'Draws a frame around nodes that already stand together; your own lines into them become one line into the group.',
        effect: 'shared',
        domain: 'canvas',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({
            viewId,
            nodeIds: z.array(z.string().min(1)).min(1),
            label: daemonField(givenName).describe('The name of the group'),
            color: daemonField(z.string().min(1)).describe("The color of the frame; without one it is drawn in the faint gray a person's own grouping gives it")
        }),
        output: z.object({
            viewId,
            view: viewName,
            groupId: z.string().min(1),
            members: z.array(z.string().min(1)),
            label: z.string().optional(),
            // Nodes nobody named that the frame ended up around.
            also: z.array(z.object({ nodeId, kind: ActionCanvasNodeKindSchema, title: z.string() })).optional(),
            // The agent's own lines into the members that the one line into the group replaced.
            edges: z.object({ replaced: z.number().int(), edgeId: z.string() }).nullable().optional()
        })
    },
    'group.arrange': {
        title: 'Arrange group',
        description:
            'Tidies the nodes that stand directly in a group into a grid under its title bar. The frame only grows, and nothing is moved into or out of another group.',
        effect: 'shared',
        domain: 'canvas',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId, groupId: nodeId }),
        output: z.object({
            viewId,
            view: viewName,
            groupId: nodeId,
            // Everything that moved: members, the nodes and texts a nested group carries.
            nodeIds: z.array(z.string().min(1)),
            changed: z.boolean()
        })
    },
    'canvas.fit': {
        title: 'Zoom to fit',
        description: 'Fits all content of the active canvas, drawing or diagram in the viewport.',
        effect: 'local',
        domain: 'canvas',
        actors: CLIENT_ACTORS,
        input: z.object({ viewId }),
        output: z.object({ viewId, view: viewName })
    },
    'history.undo': {
        title: 'Undo change',
        description: 'Undoes the latest change in the active canvas, drawing or diagram.',
        effect: 'shared',
        domain: 'canvas',
        actors: CLIENT_ACTORS,
        input: z.object({ viewId }),
        output: z.object({ viewId, view: viewName, changed: z.boolean() })
    },
    'history.redo': {
        title: 'Redo change',
        description: 'Redoes the next change in the active canvas, drawing or diagram.',
        effect: 'shared',
        domain: 'canvas',
        actors: CLIENT_ACTORS,
        input: z.object({ viewId }),
        output: z.object({ viewId, view: viewName, changed: z.boolean() })
    },
    'canvasText.create': {
        title: 'Add canvas text',
        description: 'Adds a text element to the active canvas at a world position or near the middle of the screen. Without text it opens for typing.',
        effect: 'shared',
        domain: 'canvas',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId, text: z.string().trim().min(1).nullable(), at: worldPoint.nullable() }),
        output: z.object({ viewId, view: viewName, textId: z.string().min(1) })
    },
    'node.promoteToView': {
        title: 'Open canvas node as view',
        description:
            'Lifts a chat, terminal, browser or device node off the active canvas into a view of its own, keeping its session. Lines drawn to it are removed, after confirmation.',
        effect: 'shared',
        domain: 'canvas',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId, nodeId: z.string().min(1) }),
        output: z.object({ viewId, nodeId: z.string().min(1), view: z.string(), kind: ActionViewKindSchema })
    },
    'node.moveToView': {
        title: 'Move canvas node to view',
        description:
            'Moves one node from the active canvas to another canvas view, keeping its id and session. Lines drawn to it are removed, after confirmation.',
        effect: 'shared',
        domain: 'canvas',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId, nodeId: z.string().min(1), targetViewId: viewId }),
        output: z.object({ viewId, nodeId: z.string().min(1), node: z.string(), targetViewId: viewId, target: viewName })
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
    'layout.save': {
        title: 'Save canvas layout',
        description: 'Saves where the nodes and text of the active canvas are under a name. A saved layout with the same name is replaced, after confirmation.',
        effect: 'shared',
        domain: 'layout',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId, name: givenName }),
        output: z.object({ viewId, view: viewName, name: viewName, replaced: z.boolean() })
    },
    'layout.apply': {
        title: 'Apply canvas layout',
        description: 'Moves the nodes and text of the active canvas to where a saved layout has them. Nothing is added or removed.',
        effect: 'shared',
        domain: 'layout',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId, name: viewName }),
        output: z.object({ viewId, view: viewName, name: viewName })
    },
    'layout.delete': {
        title: 'Delete canvas layout',
        description: 'Deletes a saved layout of the active canvas, after confirmation. The nodes stay where they are.',
        effect: 'shared',
        domain: 'layout',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId, name: viewName }),
        output: z.object({ viewId, view: viewName, name: viewName })
    },
    'canvas.setLocks': {
        title: 'Lock canvas gestures',
        description: 'Locks or unlocks panning, zooming, moving and resizing on the active canvas in this client. Without gestures it sets all four.',
        effect: 'local',
        domain: 'canvas',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId, locked: z.boolean(), gestures: z.array(z.enum(LOCK_GESTURES)).min(1).nullable() }),
        output: z.object({
            viewId,
            view: viewName,
            locks: z.object({ pan: z.boolean(), zoom: z.boolean(), move: z.boolean(), resize: z.boolean() })
        })
    },
    'split.create': {
        title: 'Split view',
        description: 'Opens a view in a new cell to the right of or below the focused one. Without a view it takes the first one that is not on screen yet.',
        effect: 'local',
        domain: 'layout',
        actors: PERSON_AND_VOICE,
        input: z.object({ direction: z.enum(['right', 'down']), viewId: viewId.nullable() }),
        output: z.object({ viewId, view: z.string(), direction: z.enum(['right', 'down']) })
    },
    'split.close': {
        title: 'Close split cell',
        description: 'Closes the cell a view stands in, or the focused cell. Closing the last cell shows the empty view screen. The view stays in the project.',
        effect: 'local',
        domain: 'layout',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId: viewId.nullable() }),
        output: z.object({ viewId, view: z.string() })
    },
    'split.focus': {
        title: 'Focus neighboring cell',
        description: 'Moves the focus to the cell left of, right of, above or below the focused one.',
        effect: 'local',
        domain: 'layout',
        actors: PERSON_AND_VOICE,
        input: z.object({ direction: z.enum(['left', 'right', 'up', 'down']) }),
        output: z.object({ viewId, view: z.string(), changed: z.boolean() })
    },
    'split.placeView': {
        title: 'Place view in grid',
        description:
            'Puts a view or files at an edge to split a cell, or in its center to replace it. With tabGap, a center drop joins the tabs instead. A view already on screen moves there, and a view it replaces moves to where it came from.',
        effect: 'local',
        domain: 'layout',
        actors: PERSON_AND_VOICE,
        input: z.object({
            viewId: viewId.nullable().describe('A view of the project'),
            paths: z.array(filePath).min(1).nullable().describe('Files instead of a view; the first takes the place'),
            cellViewId: viewId.nullable().describe('The cell, by the view standing in it as workspace.inspect lists the cells; null for the focused cell'),
            zone: z.enum(['left', 'right', 'up', 'down', 'center']),
            tabGap: z
                .number()
                .int()
                .nonnegative()
                .nullable()
                .optional()
                .describe('For a center drop, join the tabs at this gap instead of replacing the cell; null inserts after the active tab')
        }),
        output: z.object({ viewId, view: z.string(), cellViewId: viewId, zone: z.string(), created: z.array(viewId) })
    }
} as const;
