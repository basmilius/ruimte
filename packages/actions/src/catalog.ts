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
/* In world units, the canvas's own coordinates, so a camera move does not change where it lands. */
const worldPoint = z.object({ x: z.number(), y: z.number() });
const LOCK_GESTURES = ['pan', 'zoom', 'move', 'resize'] as const;
const PERSON_AND_VOICE: readonly ActionActorKind[] = ['person', 'voice'];

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
        actors: ACTION_ACTOR_KINDS,
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
        actors: ACTION_ACTOR_KINDS,
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
        actors: ACTION_ACTOR_KINDS,
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
        actors: ACTION_ACTOR_KINDS,
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
        actors: ['person', 'voice', 'agent'] as readonly ActionActorKind[],
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
        effect: 'shared',
        domain: 'views',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({
            kind: ActionCreatableViewKindSchema,
            name: z.string().trim().min(1).nullable(),
            url: z.string().trim().min(1).nullable(),
            command: z.string().trim().min(1).nullable(),
            path: z.string().trim().min(1).nullable(),
            provider: AgentKindSchema.nullable()
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
        effect: 'shared',
        domain: 'views',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({ viewId }),
        output: z.object({
            viewId,
            view: viewName,
            kind: ActionViewKindSchema
        })
    },
    'node.focus': {
        title: 'Focus canvas node',
        description: 'Selects and brings a node on the active canvas into view.',
        effect: 'local',
        domain: 'canvas',
        actors: ACTION_ACTOR_KINDS,
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
        effect: 'shared',
        domain: 'canvas',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({
            viewId,
            kind: ActionCreatableCanvasNodeKindSchema,
            title: z.string().trim().min(1).nullable(),
            content: z.string().nullable(),
            url: z.string().trim().min(1).nullable(),
            command: z.string().trim().min(1).nullable(),
            path: z.string().trim().min(1).nullable(),
            provider: AgentKindSchema.nullable(),
            at: worldPoint.nullable()
        }),
        output: z.object({
            viewId,
            view: viewName,
            nodeId: z.string().min(1),
            node: z.string(),
            kind: ActionCanvasNodeKindSchema
        })
    },
    'node.duplicate': {
        title: 'Duplicate canvas node',
        description: 'Duplicates one node on the active canvas and selects the copy.',
        effect: 'shared',
        domain: 'canvas',
        actors: ACTION_ACTOR_KINDS,
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
        actors: ACTION_ACTOR_KINDS,
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
        effect: 'shared',
        domain: 'canvas',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({ viewId, nodeIds: z.array(z.string().min(1)).min(1) }),
        output: z.object({
            viewId,
            view: viewName,
            nodeIds: z.array(z.string().min(1)),
            nodes: z.array(z.string())
        })
    },
    'group.create': {
        title: 'Group canvas nodes',
        description: 'Creates a group frame around one or more nodes on the active canvas.',
        effect: 'shared',
        domain: 'canvas',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({ viewId, nodeIds: z.array(z.string().min(1)).min(1) }),
        output: z.object({
            viewId,
            view: viewName,
            groupId: z.string().min(1),
            members: z.array(z.string().min(1))
        })
    },
    'canvas.fit': {
        title: 'Zoom to fit',
        description: 'Fits all content of the active canvas, drawing or diagram in the viewport.',
        effect: 'local',
        domain: 'canvas',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({ viewId }),
        output: z.object({ viewId, view: viewName })
    },
    'history.undo': {
        title: 'Undo change',
        description: 'Undoes the latest change in the active canvas, drawing or diagram.',
        effect: 'shared',
        domain: 'canvas',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({ viewId }),
        output: z.object({ viewId, view: viewName, changed: z.boolean() })
    },
    'history.redo': {
        title: 'Redo change',
        description: 'Redoes the next change in the active canvas, drawing or diagram.',
        effect: 'shared',
        domain: 'canvas',
        actors: ACTION_ACTOR_KINDS,
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
        actors: ACTION_ACTOR_KINDS,
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
        description: 'Reads a limited recent excerpt of a loaded AI Chat without including reasoning or tool output.',
        effect: 'read',
        domain: 'communicate',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({ chatId: z.string().min(1), limit: z.number().int().min(1).max(20) }),
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
    }
} as const;

export type ActionName = keyof typeof ACTION_DEFINITIONS;
export type ActionInput<Name extends ActionName> = z.input<(typeof ACTION_DEFINITIONS)[Name]['input']>;
export type ActionOutput<Name extends ActionName> = z.output<(typeof ACTION_DEFINITIONS)[Name]['output']>;
export type ActionActorKind = z.infer<typeof ActionActorKindSchema>;
export type ActionEffect = (typeof ACTION_DEFINITIONS)[ActionName]['effect'];
