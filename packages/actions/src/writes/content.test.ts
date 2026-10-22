import { DRAWING_TEXT_SIZE_MAX, DrawingElementSchema } from '@ruimte/contracts';
import { MAX_PER_CALL, type ActionInput } from '../index.ts';
import { describeWrites } from './harness.ts';
import { sampleOf } from './sample.ts';

const rect = { kind: 'rect', x: 0, y: 0, w: 120, h: 60, text: null, color: 'blue' } as const;
const style = {
    stroke: 'red',
    fill: null,
    fillColor: null,
    noteColor: null,
    strokeWidth: 2,
    strokeStyle: null,
    roughness: 0,
    font: null,
    textSize: null,
    align: null
} as const;
const update: ActionInput<'drawing.updateElements'> = { viewId: 'sketch', elementIds: ['rect-1'], style, text: null, dx: 10, dy: -5 };

describeWrites('content', {
    'node.update': {
        actors: ['person', 'voice', 'agent'],
        input: { viewId: 'board', nodeId: 'note-1', text: 'Second line', append: true },
        refused: {
            'no answer to append': { viewId: 'board', nodeId: 'note-1', text: 'Hi' },
            'an empty note': { viewId: 'board', nodeId: '', text: 'Hi', append: false }
        }
    },
    'node.updateMany': {
        actors: ['agent'],
        input: {
            viewId: 'board',
            nodes: [
                { nodeId: 'note-1', text: 'Second line', append: true },
                { nodeId: 'note-2', text: 'All of it', append: false }
            ]
        },
        refused: {
            'no notes at all': { viewId: 'board', nodes: [] },
            'more notes than one call writes': {
                viewId: 'board',
                nodes: Array.from({ length: MAX_PER_CALL + 1 }, () => ({ nodeId: 'note-1', text: 'Hi', append: true }))
            },
            'no answer to append': { viewId: 'board', nodes: [{ nodeId: 'note-1', text: 'Hi' }] }
        }
    },
    'diagram.replaceContent': {
        actors: ['person', 'voice', 'agent'],
        input: { viewId: 'flow', document: '{"meta":{},"nodes":[],"groups":[],"edges":[]}' },
        refused: { 'no document': { viewId: 'flow' }, 'a document that is no text': { viewId: 'flow', document: { nodes: [] } } }
    },
    'drawing.addElements': {
        actors: ['person', 'voice'],
        input: { viewId: 'sketch', elements: [rect] },
        refused: {
            'a shape it does not draw': { viewId: 'sketch', elements: [{ ...rect, kind: 'star' }] },
            'an empty list': { viewId: 'sketch', elements: [] },
            'more than a hundred at once': { viewId: 'sketch', elements: Array.from({ length: 101 }, () => rect) },
            'a color off the palette': { viewId: 'sketch', elements: [{ ...rect, color: 'teal' }] }
        },
        restricted: {
            copies: { value: [sampleOf(DrawingElementSchema)], actors: ['person'] }
        }
    },
    'drawing.updateElements': {
        actors: ['person', 'voice'],
        input: update,
        refused: {
            'a stroke width it has not': { ...update, style: { ...style, strokeWidth: 3 } },
            'a roughness past sloppy': { ...update, style: { ...style, roughness: 3 } },
            'a text size past the largest': { ...update, style: { ...style, textSize: DRAWING_TEXT_SIZE_MAX + 1 } },
            'an empty list of elements': { ...update, elementIds: [] }
        }
    },
    'drawing.deleteElements': {
        actors: ['person', 'voice'],
        input: { viewId: 'sketch', elementIds: null },
        refused: { 'an empty element': { viewId: 'sketch', elementIds: [''] }, 'no elements at all': { viewId: 'sketch' } }
    },
    'drawing.duplicateElements': {
        actors: ['person', 'voice'],
        input: { viewId: 'sketch', elementIds: ['rect-1', 'text-1'] },
        refused: { 'an empty list': { viewId: 'sketch', elementIds: [] } }
    },
    'drawing.reorderElements': {
        actors: ['person', 'voice'],
        input: { viewId: 'sketch', elementIds: ['rect-1'], to: 'back' },
        refused: { 'a place it has not': { viewId: 'sketch', elementIds: ['rect-1'], to: 'middle' } }
    },
    'drawing.lockElements': {
        actors: ['person', 'voice'],
        input: { viewId: 'sketch', elementIds: null, locked: true },
        refused: { 'no answer to locked': { viewId: 'sketch', elementIds: null } }
    },
    'drawing.replaceContent': {
        actors: ['person', 'voice'],
        input: { viewId: 'sketch', document: '{"elements":[]}' },
        refused: { 'no document': { viewId: 'sketch' } }
    },
    'drawing.copy': {
        actors: ['person', 'voice'],
        input: { viewId: 'sketch', format: 'elements' },
        refused: { 'a format it has not': { viewId: 'sketch', format: 'pdf' } }
    },
    'drawing.export': {
        actors: ['person'],
        input: { viewId: 'sketch', format: 'svg' },
        refused: { 'elements, which are no image': { viewId: 'sketch', format: 'elements' } }
    },
    'diagram.updateNode': {
        actors: ['person', 'voice'],
        input: { viewId: 'flow', diagramNodeId: 'api', label: 'Gateway', tone: 'purple' },
        refused: {
            'a blank label': { viewId: 'flow', diagramNodeId: 'api', label: ' ', tone: null },
            'a tone off the palette': { viewId: 'flow', diagramNodeId: 'api', label: null, tone: 'teal' }
        }
    },
    'diagram.resetPosition': {
        actors: ['person', 'voice'],
        input: { viewId: 'flow', diagramNodeId: 'api' },
        refused: { 'an empty node': { viewId: 'flow', diagramNodeId: '' } }
    },
    'diagram.copy': {
        actors: ['person', 'voice'],
        input: { viewId: 'flow', format: 'json' },
        refused: { 'a format it has not': { viewId: 'flow', format: 'elements' } }
    },
    'diagram.export': {
        actors: ['person'],
        input: { viewId: 'flow', format: 'png' },
        refused: { 'json, which is no image': { viewId: 'flow', format: 'json' } }
    }
});
