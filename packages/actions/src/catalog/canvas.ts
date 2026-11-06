import { AgentKindSchema, ArtifactIdSchema, ArtifactVersionIdSchema, NODE_ACCENT_NAMES, ProviderAccountIdSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_PER_CALL } from '../limits.ts';
import {
    PERSON_AND_VOICE,
    AGENT,
    PERSON,
    ACTION_ACTOR_KINDS,
    ActionViewKindSchema,
    ActionCanvasNodeKindSchema,
    ActionCreatableCanvasNodeKindSchema,
    viewId,
    viewName,
    nodeId,
    revision,
    givenName,
    forActors,
    agentField,
    AGENT_NODE_KINDS,
    OUTPUT_NODE_KINDS,
    worldPoint,
    LOCK_GESTURES,
    PERSON_VOICE_AND_AGENT,
    CLIENT_ACTORS,
    PERSON_AND_AGENT,
    resumedSession,
    drawnLine,
    routineId,
    ARRANGE_LAYOUTS,
    flagColor,
    canvasLine
} from './fields.ts';

export const CANVAS_ACTIONS = {
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
                z.enum(AGENT_NODE_KINDS).meta({ actors: [...AGENT] }),
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
            source: agentField(viewId).describe(
                'The id of a view of this project of the same kind as the node, a drawing for a drawing and a diagram for a diagram'
            ),
            cwd: forActors(PERSON_AND_AGENT, z.string().min(1)).describe('The directory the shell starts in'),
            beside: agentField(nodeId).describe('Puts the node directly right of this node, top edges level, whatever is there already'),
            device: agentField(z.string().min(1)).describe('The device a device node shows, by the id device.list gives it'),
            resume: resumedSession,
            issue: forActors(PERSON, z.object({ repo: z.string().min(1), number: z.number().int().positive(), url: z.string().min(1) })).describe(
                'The GitHub issue an agent node is started on, which the node shows as a pill'
            ),
            color: agentField(z.enum(NODE_ACCENT_NAMES)).describe('The color of the node; a note takes its paper from it'),
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
            label: agentField(givenName).describe('The name of the group'),
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
        actors: AGENT,
        input: z.object({ viewId, edgeId: z.string().min(1) }),
        output: z.object({ viewId, ...canvasLine.shape })
    },
    'link.deleteMany': {
        title: 'Remove canvas lines',
        description:
            'Removes several lines of one canvas in one write, each the way link.delete removes one. Every line is checked before any goes, so a refusal removes none.',
        effect: 'shared',
        domain: 'canvas',
        actors: AGENT,
        input: z.object({ viewId, edgeIds: z.array(z.string().min(1)).min(1).max(MAX_PER_CALL) }),
        output: z.object({ viewId, edges: z.array(canvasLine) })
    }
} as const;
