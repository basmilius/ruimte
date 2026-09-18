import { z } from 'zod';

export const ACTION_ACTOR_KINDS = ['person', 'voice', 'agent', 'automation'] as const;
export const ActionActorKindSchema = z.enum(ACTION_ACTOR_KINDS);

export const VIEW_KINDS = ['canvas', 'drawing', 'diagram', 'file', 'terminal', 'browser', 'chat', 'separator', 'unknown'] as const;
export const ActionViewKindSchema = z.enum(VIEW_KINDS);

export const CREATABLE_VIEW_KINDS = ['canvas', 'drawing', 'diagram', 'terminal', 'browser', 'chat'] as const;
export const ActionCreatableViewKindSchema = z.enum(CREATABLE_VIEW_KINDS);

export const CANVAS_NODE_KINDS = ['terminal', 'chat', 'browser', 'group', 'note', 'drawing', 'diagram', 'file', 'unknown'] as const;
export const ActionCanvasNodeKindSchema = z.enum(CANVAS_NODE_KINDS);

export const CREATABLE_CANVAS_NODE_KINDS = ['terminal', 'chat', 'browser', 'group', 'note'] as const;
export const ActionCreatableCanvasNodeKindSchema = z.enum(CREATABLE_CANVAS_NODE_KINDS);

const viewId = z.string().min(1);
const viewName = z.string().trim().min(1);

export const ACTION_DEFINITIONS = {
    'workspace.inspect': {
        title: 'Inspect workspace',
        description: 'Reads the current project, active view, openable views, active canvas nodes and selection.',
        effect: 'read',
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
    'view.focus': {
        title: 'Focus view',
        description: 'Shows an existing view in the client that initiated the action.',
        effect: 'local',
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
        description: 'Creates and focuses a new canvas, drawing, diagram, terminal, browser or AI Chat view.',
        effect: 'shared',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({
            kind: ActionCreatableViewKindSchema,
            name: z.string().trim().min(1).nullable(),
            url: z.string().trim().min(1).nullable(),
            command: z.string().trim().min(1).nullable()
        }),
        output: z.object({
            viewId,
            view: viewName,
            kind: ActionCreatableViewKindSchema
        })
    },
    'view.delete': {
        title: 'Delete view',
        description: 'Deletes a view and everything it contains after confirmation.',
        effect: 'shared',
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
        description: 'Creates a node in free space near the center of the active canvas.',
        effect: 'shared',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({
            viewId,
            kind: ActionCreatableCanvasNodeKindSchema,
            title: z.string().trim().min(1).nullable(),
            content: z.string().nullable(),
            url: z.string().trim().min(1).nullable(),
            command: z.string().trim().min(1).nullable()
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
        title: 'Fit canvas',
        description: 'Fits all content of the active canvas in the viewport.',
        effect: 'local',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({ viewId }),
        output: z.object({ viewId, view: viewName })
    },
    'history.undo': {
        title: 'Undo canvas change',
        description: 'Undoes the latest shared canvas change in the active view.',
        effect: 'shared',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({ viewId }),
        output: z.object({ viewId, view: viewName, changed: z.boolean() })
    },
    'history.redo': {
        title: 'Redo canvas change',
        description: 'Redoes the next shared canvas change in the active view.',
        effect: 'shared',
        actors: ACTION_ACTOR_KINDS,
        input: z.object({ viewId }),
        output: z.object({ viewId, view: viewName, changed: z.boolean() })
    },
    'chat.send': {
        title: 'Send AI Chat prompt',
        description: 'Submits a direct prompt to an existing AI Chat view or node.',
        effect: 'external',
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
    'chat.read': {
        title: 'Read recent AI Chat messages',
        description: 'Reads a limited recent excerpt of a loaded AI Chat without including reasoning or tool output.',
        effect: 'read',
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
