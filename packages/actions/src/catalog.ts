import { AgentKindSchema, AgentStatusSchema, NodeKindSchema, PROJECT_VIEW_KINDS, UNKNOWN_KIND } from '@ruimte/contracts';
import { z } from 'zod';

export const ACTION_ACTOR_KINDS = ['person', 'voice', 'agent', 'automation'] as const;
export const ActionActorKindSchema = z.enum(ACTION_ACTOR_KINDS);

/* What an action is about. Voice gets one tool per domain, so this is also how its tools are cut. */
export const ACTION_DOMAINS = ['workspace', 'views', 'canvas', 'layout', 'communicate', 'agents', 'projects'] as const;
export type ActionDomain = (typeof ACTION_DOMAINS)[number];

/* Every kind a project knows, plus the one a newer Ruimte made. An action may name a view this version cannot open. */
export const ActionViewKindSchema = z.enum([...PROJECT_VIEW_KINDS, UNKNOWN_KIND]);
export const VIEW_KINDS = ActionViewKindSchema.options;

/* What an action may ask to be made. Shorter than what it can name, and this catalog's own decision. */
export const CREATABLE_VIEW_KINDS = ['canvas', 'drawing', 'diagram', 'terminal', 'browser', 'chat', 'file', 'separator', 'subheader'] as const;
export const ActionCreatableViewKindSchema = z.enum(CREATABLE_VIEW_KINDS);

export const ActionCanvasNodeKindSchema = z.enum([...NodeKindSchema.options, UNKNOWN_KIND]);
export const CANVAS_NODE_KINDS = ActionCanvasNodeKindSchema.options;

export const CREATABLE_CANVAS_NODE_KINDS = ['terminal', 'chat', 'browser', 'group', 'note', 'file'] as const;
export const ActionCreatableCanvasNodeKindSchema = z.enum(CREATABLE_CANVAS_NODE_KINDS);

const viewId = z.string().min(1);
const viewName = z.string().trim().min(1);
const nodeId = z.string().min(1);

/*
 * A field only these actors may fill: what one executor honors and another would drop. Voice's tools
 * leave it out and the registry refuses a value in it from anyone else. Absent reads as null.
 */
const forActors = <Schema extends z.ZodType>(actors: readonly ActionActorKind[], schema: Schema) => schema.nullish().meta({ actors: [...actors] });
const agentField = <Schema extends z.ZodType>(schema: Schema) => forActors(['agent'], schema);

/* The actors a field or a member of a union is kept for; null when every actor of its action may fill it. */
export const fieldActors = (schema: z.ZodType): readonly ActionActorKind[] | null => {
    const actors = (schema.meta() as { actors?: unknown } | undefined)?.actors;
    return Array.isArray(actors) ? (actors as ActionActorKind[]) : null;
};

/* What a field says about itself, looked up under the wrappers that make it optional or nullable. */
export const fieldDescription = (schema: z.ZodType): string | undefined => {
    let current: z.ZodType | undefined = schema;
    while (current !== undefined) {
        if (current.description !== undefined) {
            return current.description;
        }
        current = 'unwrap' in current && typeof current.unwrap === 'function' ? (current.unwrap() as z.ZodType) : undefined;
    }
    return undefined;
};

export const ARRANGE_LAYOUTS = ['grid', 'row', 'column'] as const;

/* Kinds a node can only be made as by an agent: each mirrors a view the daemon names with `source`. */
const AGENT_NODE_KINDS = ['drawing', 'diagram'] as const;

/* In world units, the canvas's own coordinates, so a camera move does not change where it lands. */
const worldPoint = z.object({ x: z.number(), y: z.number() });
const LOCK_GESTURES = ['pan', 'zoom', 'move', 'resize'] as const;
const PERSON_AND_VOICE: readonly ActionActorKind[] = ['person', 'voice'];
/* What only a client runs: no agent reaches a client, so an agent is left out. */
const CLIENT_ACTORS: readonly ActionActorKind[] = ['person', 'voice', 'automation'];
const AGENT: readonly ActionActorKind[] = ['agent'];

export const TARGET_KINDS = ['view', 'node', 'chat', 'agent', 'project'] as const;
const resolvedTarget = z.object({
    id: z.string(),
    name: z.string(),
    kind: z.string(),
    viewId: z.string().nullable(),
    view: z.string().nullable(),
    endpointId: z.string().nullable(),
    machine: z.string().nullable()
});

export const ACTION_DEFINITIONS = {
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
    'projects.list-open': {
        title: 'List open projects',
        description: 'Lists projects in use in the project navigation, excluding Recent.',
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
                    active: z.boolean(),
                    available: z.boolean()
                })
            )
        })
    },
    'project.switch': {
        title: 'Switch open project',
        description: 'Switches this window to an existing open project.',
        effect: 'local',
        domain: 'projects',
        actors: ['person', 'voice'] as readonly ActionActorKind[],
        input: z.object({ endpointId: z.string().min(1), projectId: z.string().min(1) }),
        output: z.object({ project: z.string(), endpointId: z.string(), projectId: z.string() })
    },
    'workspace.inspect': {
        title: 'Inspect workspace',
        description: 'Reads the current project, active view, openable views, active canvas nodes and selection.',
        effect: 'read',
        domain: 'workspace',
        actors: CLIENT_ACTORS,
        input: z.object({}),
        output: z.object({
            project: z.string(),
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
            canvas: z
                .object({
                    viewId,
                    nodes: z.array(
                        z.object({
                            id: z.string().min(1),
                            title: z.string(),
                            kind: ActionCanvasNodeKindSchema,
                            visible: z.boolean()
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
                .nullable()
        })
    },
    'target.resolve': {
        title: 'Resolve names',
        description:
            'Turns spoken or typed names of views, nodes on the active canvas, AI Chats, agents or open projects into ids. A name that fits more than one comes back under ambiguous with every candidate, never as the first of them. Without names it returns the current ones: the active view, the nodes in scope (the selection unless a scope is given), the active or selected AI Chat, the selected agent or the active project. Scope and nodeKind narrow nodes, machine narrows projects.',
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
        input: z.object({ viewId, name: viewName }),
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
            'Creates and focuses a new canvas, drawing, diagram, terminal, browser, AI Chat or file view, or adds a separator or subheader to the view list. A chat or terminal can run a specific agent CLI; a file view shows the file at a path, relative to the project folder or absolute.',
        agentDescription: 'Adds a view to the sidebar, written down as yours.',
        effect: 'shared',
        domain: 'views',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({
            kind: ActionCreatableViewKindSchema,
            name: z.string().trim().min(1).nullable(),
            url: z.string().trim().min(1).nullable().describe('An http or https address'),
            command: z.string().trim().min(1).nullable(),
            path: z.string().trim().min(1).nullable().describe('The file the view shows, relative to the project folder or absolute'),
            provider: AgentKindSchema.nullable(),
            after: agentField(viewId).describe('Puts the row right under this view; without it the row goes last')
        }),
        output: z.object({
            viewId,
            view: viewName,
            kind: ActionCreatableViewKindSchema
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
        input: z.object({ viewId, nodeId: z.string().min(1), name: viewName }),
        output: z.object({
            viewId,
            nodeId: z.string().min(1),
            kind: ActionCanvasNodeKindSchema,
            previousName: z.string(),
            name: viewName,
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
            kind: z.union([ActionCreatableCanvasNodeKindSchema, z.enum(AGENT_NODE_KINDS).meta({ actors: [...AGENT] })]),
            title: z.string().trim().min(1).nullable(),
            content: z.string().nullable().describe('The body of a note'),
            url: z.string().trim().min(1).nullable().describe('An http or https address'),
            command: z.string().trim().min(1).nullable(),
            path: z.string().trim().min(1).nullable().describe('The file the node shows, relative to the project folder or absolute'),
            provider: AgentKindSchema.nullable(),
            at: worldPoint.nullable(),
            source: agentField(viewId).describe(
                'The id of a view of this project of the same kind as the node, a drawing for a drawing and a diagram for a diagram'
            ),
            cwd: agentField(z.string().min(1)).describe('The directory the shell starts in'),
            beside: agentField(nodeId).describe('Puts the node directly right of this node, top edges level, whatever is there already')
        }),
        output: z.object({
            viewId,
            view: viewName,
            nodeId: z.string().min(1),
            node: z.string(),
            kind: ActionCanvasNodeKindSchema,
            // The line drawn from the agent into what it made; a dry run has no id for it yet.
            edge: z.object({ edgeId: z.string().nullable(), from: nodeId, to: nodeId }).nullable().optional()
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
        description: 'Replaces the active canvas selection with specific nodes.',
        effect: 'local',
        domain: 'canvas',
        actors: CLIENT_ACTORS,
        input: z.object({ viewId, nodeIds: z.array(z.string().min(1)).min(1) }),
        output: z.object({
            viewId,
            view: viewName,
            nodeIds: z.array(z.string().min(1)),
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
            label: agentField(viewName).describe('The name of the group'),
            color: agentField(z.string().min(1)).describe("The color of the frame; without one it is drawn in the faint gray a person's own grouping gives it")
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
        description: 'Turns a chat, terminal, browser or device view into a node on the canvas that was open last, keeping its session, and shows that canvas.',
        effect: 'shared',
        domain: 'views',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId }),
        output: z.object({ viewId, view: z.string(), canvasViewId: viewId, canvas: viewName })
    },
    'view.showOnCanvas': {
        title: 'Show view on canvas',
        description: 'Puts a live mirror of a drawing or diagram view on the canvas that was open last and shows it there. The view itself stays.',
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
        actors: ['person'] as readonly ActionActorKind[],
        input: z.object({ viewId, shared: z.boolean() }),
        output: z.object({ viewId, view: z.string(), shared: z.boolean(), changed: z.boolean() })
    },
    'layout.save': {
        title: 'Save canvas layout',
        description: 'Saves where the nodes and text of the active canvas are under a name. A saved layout with the same name is replaced, after confirmation.',
        effect: 'shared',
        domain: 'layout',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId, name: viewName }),
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
        description: 'Closes the cell a view stands in, or the focused cell, while more than one is open. The view stays in the project.',
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
            prompt: z.string().trim().min(1)
        }),
        output: z.object({
            chatId: z.string().min(1),
            chat: z.string(),
            queued: z.boolean(),
            turnId: z.string().min(1).optional()
        })
    },
    'chat.clear': {
        title: 'Clear AI Chat',
        description: 'Clears conversation history, attachments and plans, and stops the current turn after confirmation. Keeps the chat node or view.',
        effect: 'external',
        domain: 'communicate',
        actors: ['person', 'voice'] as readonly ActionActorKind[],
        input: z.object({ chatId: z.string().min(1) }),
        output: z.object({ chatId: z.string().min(1), chat: z.string() })
    },
    'chat.read': {
        title: 'Read recent AI Chat messages',
        description: 'Reads a limited recent excerpt of a loaded AI Chat without including reasoning or tool output. A null limit reads the last 20 messages.',
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
    'view.list': {
        title: 'List views',
        description: 'Lists the views of the project in sidebar order, with whether you may delete each and why.',
        effect: 'read',
        domain: 'views',
        actors: AGENT,
        input: z.object({}),
        output: z.object({
            views: z.array(z.object({ viewId, kind: ActionViewKindSchema, name: z.string(), deletable: z.boolean(), why: z.string() })),
            // The view the caller is in: the canvas it is a node on, or its own id when it is a view.
            self: z.string()
        })
    },
    'view.setIcon': {
        title: 'Mark view',
        description: 'Gives a view a mark of its own from the Lucide names the picker has.',
        effect: 'shared',
        domain: 'views',
        actors: AGENT,
        input: z.object({ viewId, icon: z.string().min(1).describe('A Lucide name from the set the picker has') }),
        output: z.object({ viewId, kind: ActionViewKindSchema, icon: z.object({ kind: z.literal('lucide'), value: z.string() }) })
    },
    'view.move': {
        title: 'Move view',
        description: 'Moves a view to another place in the sidebar.',
        effect: 'shared',
        domain: 'views',
        actors: AGENT,
        input: z.object({ viewId, afterViewId: viewId.nullable().describe('The view it goes right under; without one it goes to the top') }),
        output: z.object({ viewId, kind: ActionViewKindSchema, index: z.number().int() })
    },
    'node.list': {
        title: 'List canvas nodes',
        description: 'Lists the nodes of a canvas, where each stands and the group it is in.',
        effect: 'read',
        domain: 'canvas',
        actors: AGENT,
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
                    groupId: z.string().nullable()
                })
            ),
            // The caller when it is one of these nodes.
            self: z.string().nullable()
        })
    },
    'node.update': {
        title: 'Write in a note',
        description: 'Writes the body of a note you made or a line joins you to; append puts the text under what is there instead of over it.',
        effect: 'shared',
        domain: 'canvas',
        actors: AGENT,
        input: z.object({
            viewId,
            nodeId,
            text: z.string().describe('What to write'),
            append: z.boolean().describe('Adds the text as a line under what is there instead of replacing the body')
        }),
        output: z.object({ viewId, nodeId, lines: z.number().int(), characters: z.number().int(), changed: z.boolean() })
    },
    'node.arrange': {
        title: 'Arrange canvas nodes',
        description: 'Lays nodes out in a grid, a row or a column without overlap.',
        effect: 'shared',
        domain: 'canvas',
        actors: AGENT,
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
        actors: AGENT,
        input: z.object({ viewId }),
        output: z.object({ viewId, edges: z.array(z.object({ edgeId: z.string(), from: nodeId, to: nodeId, label: z.string().nullable() })) })
    },
    'link.create': {
        title: 'Draw canvas lines',
        description: 'Draws a context line between nodes of one canvas; between two agents it draws both ways.',
        effect: 'shared',
        domain: 'canvas',
        actors: AGENT,
        input: z.object({
            viewId,
            from: nodeId.nullable().describe('Where the line starts; without it, you'),
            to: z.array(nodeId).min(1).describe('The nodes the line runs into'),
            label: viewName.nullable().describe('What the line is called on the canvas'),
            role: z.string().min(1).nullable().describe('What the line is for')
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
        actors: AGENT,
        input: z.object({ viewId, edgeId: z.string().min(1) }),
        output: z.object({ viewId, edgeId: z.string(), from: nodeId, to: nodeId, label: z.string().nullable() })
    }
} as const;

export type ActionName = keyof typeof ACTION_DEFINITIONS;
export type ActionInput<Name extends ActionName> = z.input<(typeof ACTION_DEFINITIONS)[Name]['input']>;
export type ActionOutput<Name extends ActionName> = z.output<(typeof ACTION_DEFINITIONS)[Name]['output']>;
export type ActionActorKind = z.infer<typeof ActionActorKindSchema>;
export type ActionEffect = (typeof ACTION_DEFINITIONS)[ActionName]['effect'];

/* What an action does, in the words for this actor: an agent reaches the daemon's executor, whose rules differ. */
export const actionDescription = (name: ActionName, actor: ActionActorKind): string => {
    const definition = ACTION_DEFINITIONS[name];
    return actor === 'agent' && 'agentDescription' in definition ? definition.agentDescription : definition.description;
};
