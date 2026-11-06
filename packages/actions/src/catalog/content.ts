import { DiagramDirectionSchema, DiagramShapeSchema, DrawingColorSchema, DrawingElementSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_PER_CALL } from '../limits.ts';
import {
    PERSON_AND_VOICE,
    AGENT,
    PERSON,
    viewId,
    nodeId,
    revision,
    forActors,
    PERSON_VOICE_AND_AGENT,
    diagramDocument,
    drawingView,
    diagramView,
    elementIds,
    newElement,
    drawingStyle,
    drawingChange,
    diagramNodeId,
    imageFormat
} from './fields.ts';

export const CONTENT_ACTIONS = {
    'diagram.replaceContent': {
        title: 'Replace a diagram',
        description: 'Replaces everything a diagram on screen holds with a JSON document; undo brings the old one back while it stays open.',
        agentDescription: 'Replaces the whole diagram of a diagram view with a JSON document.',
        effect: 'shared',
        domain: 'content',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({
            viewId: viewId.describe('A diagram view of this project'),
            document: diagramDocument
        }),
        output: z.object({ viewId, rev: z.number().int(), nodes: z.number().int(), groups: z.number().int(), edges: z.number().int() })
    },
    'note.read': {
        title: 'Read a note',
        description: 'Reads what a note on a canvas says.',
        effect: 'read',
        domain: 'content',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId, nodeId: nodeId.describe('The note, by id') }),
        output: z.object({ viewId, nodeId, note: z.string(), text: z.string(), truncated: z.boolean() })
    },
    'drawing.read': {
        title: 'Read a drawing',
        description: 'Lists the elements of a drawing on screen, back to front, with where each stands and what it says.',
        effect: 'read',
        domain: 'content',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId: drawingView }),
        output: z.object({
            viewId,
            view: z.string(),
            elements: z.array(
                z.object({
                    id: z.string(),
                    kind: z.string(),
                    x: z.number(),
                    y: z.number(),
                    w: z.number(),
                    h: z.number(),
                    text: z.string().nullable(),
                    color: z.string(),
                    locked: z.boolean()
                })
            ),
            selected: z.array(z.string()),
            truncated: z.boolean(),
            // Of the drawing's own file, as this window last saved or read it.
            revision
        })
    },
    'drawing.addElements': {
        title: 'Draw elements',
        description: 'Adds finished shapes, lines, arrows, texts and notes to a drawing on screen, in the style the dock has up.',
        effect: 'shared',
        domain: 'content',
        actors: PERSON_AND_VOICE,
        input: z.object({
            viewId: drawingView,
            elements: z.array(newElement).min(1).max(100).nullable().describe('The elements to draw, back to front'),
            copies: forActors(PERSON, z.array(DrawingElementSchema).min(1)).describe(
                'Whole elements from the clipboard; they arrive under new ids, a step aside'
            )
        }),
        output: drawingChange
    },
    'drawing.updateElements': {
        title: 'Change elements',
        description: 'Restyles, moves or rewrites elements of a drawing on screen; a locked element stays as it is.',
        effect: 'shared',
        domain: 'content',
        actors: PERSON_AND_VOICE,
        input: z.object({
            viewId: drawingView,
            elementIds,
            style: drawingStyle
                .nullable()
                .describe('What changes in the style; null in a field keeps it. Without elements it also becomes what the next element is drawn with'),
            text: z.string().nullable().describe('What a text or a note says from now on'),
            dx: z.number().nullable().describe('How far right to move them; negative for left'),
            dy: z.number().nullable().describe('How far down to move them; negative for up')
        }),
        output: drawingChange
    },
    'drawing.deleteElements': {
        title: 'Delete elements',
        description: 'Takes elements off a drawing on screen; undo brings them back. A locked element stays.',
        effect: 'shared',
        domain: 'content',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId: drawingView, elementIds }),
        output: drawingChange
    },
    'drawing.duplicateElements': {
        title: 'Duplicate elements',
        description: 'Copies elements of a drawing on screen a step aside and selects the copies.',
        effect: 'shared',
        domain: 'content',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId: drawingView, elementIds }),
        output: drawingChange
    },
    'drawing.reorderElements': {
        title: 'Bring forward or send back',
        description: 'Moves elements of a drawing on screen in front of everything else, or behind it.',
        effect: 'shared',
        domain: 'content',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId: drawingView, elementIds, to: z.enum(['front', 'back']) }),
        output: drawingChange
    },
    'drawing.lockElements': {
        title: 'Lock or unlock elements',
        description: 'Locks elements of a drawing on screen in place, so a click or a drag no longer picks them up, or unlocks them.',
        effect: 'shared',
        domain: 'content',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId: drawingView, elementIds, locked: z.boolean() }),
        output: drawingChange
    },
    'drawing.replaceContent': {
        title: 'Replace a drawing',
        description: 'Replaces every element of a drawing on screen with a JSON document; undo brings the old ones back while it stays open.',
        effect: 'shared',
        domain: 'content',
        actors: PERSON_AND_VOICE,
        input: z.object({
            viewId: drawingView,
            document: z.string().describe('The drawing as one JSON object with an elements array, the shape its file has')
        }),
        output: z.object({ viewId, view: z.string(), elements: z.number().int() })
    },
    'drawing.copy': {
        title: 'Copy a drawing',
        description: 'Copies the selection of a drawing on screen, or all of it, to the clipboard as a PNG, an SVG or as elements to paste in another drawing.',
        effect: 'local',
        domain: 'content',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId: drawingView, format: z.enum(['png', 'svg', 'elements']) }),
        output: z.object({ viewId, view: z.string(), format: z.string(), elements: z.number().int() })
    },
    'drawing.export': {
        title: 'Save a drawing as an image',
        description: 'Saves the selection of a drawing, or all of it, as a PNG or an SVG file where the person picks.',
        effect: 'local',
        domain: 'content',
        // A save dialog is a person's to answer.
        actors: PERSON,
        input: z.object({ viewId: drawingView, format: imageFormat }),
        output: z.object({ viewId, view: z.string(), format: z.string() })
    },
    'drawing.edit': {
        title: 'Edit a drawing',
        description: 'Adds, changes and removes elements of a drawing view by id in one step, while a person may draw in it at the same time.',
        effect: 'shared',
        domain: 'content',
        actors: AGENT,
        input: z.object({
            viewId: viewId.describe('A drawing view of this project, or the id of a node that shows one'),
            revision: revision.describe('The revision of the drawing the edit was decided on, as read --elements printed it'),
            edit: z.string().describe('One JSON object with add, update and remove')
        }),
        output: z.object({ viewId, rev: z.number().int(), added: z.array(z.string()), elements: z.number().int() })
    },
    'diagram.read': {
        title: 'Read a diagram',
        description: 'Reads the nodes, groups and edges of a diagram on screen.',
        effect: 'read',
        domain: 'content',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId: diagramView }),
        output: z.object({
            viewId,
            view: z.string(),
            title: z.string(),
            direction: DiagramDirectionSchema,
            nodes: z.array(
                z.object({
                    id: z.string(),
                    label: z.string(),
                    shape: DiagramShapeSchema.nullable(),
                    tone: DrawingColorSchema.nullable(),
                    // Dragged by a person, so the layout no longer places it.
                    pinned: z.boolean()
                })
            ),
            groups: z.array(z.object({ id: z.string(), label: z.string(), wraps: z.array(z.string()) })),
            edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().nullable() })),
            // Of the diagram's own file, as this window last saved or read it.
            revision
        })
    },
    'diagram.updateNode': {
        title: 'Change a diagram node',
        description: 'Renames a node of a diagram on screen or gives it another color.',
        effect: 'shared',
        domain: 'content',
        actors: PERSON_AND_VOICE,
        input: z.object({
            viewId: diagramView,
            diagramNodeId,
            label: z.string().trim().min(1).nullable().describe('The new label; null keeps it'),
            tone: DrawingColorSchema.nullable().describe('The new color; null keeps it')
        }),
        output: z.object({ viewId, view: z.string(), diagramNodeId: z.string(), label: z.string(), changed: z.boolean() })
    },
    'diagram.resetPosition': {
        title: 'Give a node back to the layout',
        description: 'Lets the layout place a node of a diagram on screen again, after it was dragged.',
        effect: 'shared',
        domain: 'content',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId: diagramView, diagramNodeId }),
        output: z.object({ viewId, view: z.string(), diagramNodeId: z.string(), label: z.string(), changed: z.boolean() })
    },
    'diagram.copy': {
        title: 'Copy a diagram',
        description: 'Copies a diagram on screen to the clipboard as a PNG, an SVG or its JSON.',
        effect: 'local',
        domain: 'content',
        actors: PERSON_AND_VOICE,
        input: z.object({ viewId: diagramView, format: z.enum(['png', 'svg', 'json']) }),
        output: z.object({ viewId, view: z.string(), format: z.string() })
    },
    'diagram.export': {
        title: 'Save a diagram as an image',
        description: 'Saves a diagram as a PNG or an SVG file where the person picks.',
        effect: 'local',
        domain: 'content',
        // A save dialog is a person's to answer.
        actors: PERSON,
        input: z.object({ viewId: diagramView, format: imageFormat }),
        output: z.object({ viewId, view: z.string(), format: z.string() })
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
        actors: AGENT,
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
    }
} as const;
