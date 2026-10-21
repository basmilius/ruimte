import { MAX_TITLE_LENGTH } from '../index.ts';
import { describeWrites, without } from './harness.ts';

const note = {
    viewId: 'board',
    kind: 'note',
    title: null,
    content: 'Ideas',
    url: null,
    command: null,
    path: null,
    provider: null,
    at: { x: 120, y: -40 }
} as const;

describeWrites('canvas', {
    'node.focus': {
        actors: ['person', 'voice', 'automation'],
        input: { viewId: 'board', nodeId: 'chat-1' },
        refused: { 'an empty node': { viewId: 'board', nodeId: '' }, 'no canvas': { nodeId: 'chat-1' } }
    },
    'node.rename': {
        actors: ['person', 'voice', 'agent', 'automation'],
        input: { viewId: 'board', nodeId: 'chat-1', name: 'Reviewer' },
        refused: {
            'a blank name': { viewId: 'board', nodeId: 'chat-1', name: ' ' },
            'a name past the title limit': { viewId: 'board', nodeId: 'chat-1', name: 'x'.repeat(MAX_TITLE_LENGTH + 1) }
        }
    },
    'node.create': {
        actors: ['person', 'voice', 'agent', 'automation'],
        input: note,
        refused: {
            'a kind no action makes': { ...note, kind: 'unknown' },
            'a point without y': { ...note, at: { x: 1 } },
            'a blank address': { ...note, url: '  ' },
            'no title at all': without(note, 'title')
        },
        restricted: {
            kind: { value: 'drawing', actors: ['agent'] },
            browserOwner: { value: 'endpoint-2', actors: ['person'] },
            account: { value: 'work', actors: ['person'] },
            source: { value: 'sketch', actors: ['agent'] },
            cwd: { value: 'apps/client', actors: ['person', 'agent'] },
            beside: { value: 'chat-1', actors: ['agent'] },
            device: { value: 'sim-1', actors: ['agent'] },
            resume: { value: 'session-1', actors: ['person'] },
            issue: { value: { repo: 'basmilius/ruimte', number: 58, url: 'https://github.com/basmilius/ruimte/issues/58' }, actors: ['person'] },
            color: { value: 'teal', actors: ['agent'] }
        }
    },
    'node.setColor': {
        actors: ['person', 'voice', 'agent'],
        input: { viewId: 'board', nodeId: 'note-1', color: 'teal' },
        refused: {
            'a paper only old notes have': { viewId: 'board', nodeId: 'note-1', color: 'gray' },
            'a color off the set': { viewId: 'board', nodeId: 'note-1', color: '#ff0000' },
            'no color at all': { viewId: 'board', nodeId: 'note-1' },
            'an empty node': { viewId: 'board', nodeId: '', color: null }
        }
    },
    'node.duplicate': {
        actors: ['person', 'voice', 'automation'],
        input: { viewId: 'board', nodeId: 'note-1' },
        refused: { 'an empty node': { viewId: 'board', nodeId: '' } }
    },
    'canvas.select': {
        actors: ['person', 'voice', 'automation'],
        input: { viewId: 'board', nodeIds: ['note-1', 'text-1'] },
        refused: { 'nothing to select': { viewId: 'board', nodeIds: [] }, 'an empty id': { viewId: 'board', nodeIds: [''] } }
    },
    'node.delete': {
        actors: ['person', 'voice', 'agent', 'automation'],
        input: { viewId: 'board', nodeIds: ['note-1'] },
        refused: { 'nothing to delete': { viewId: 'board', nodeIds: [] }, 'one id instead of a list': { viewId: 'board', nodeIds: 'note-1' } },
        confirms: true
    },
    'group.create': {
        actors: ['person', 'voice', 'agent', 'automation'],
        input: { viewId: 'board', nodeIds: ['note-1', 'chat-1'] },
        refused: { 'nothing to group': { viewId: 'board', nodeIds: [] } },
        restricted: {
            label: { value: 'Research', actors: ['agent'] },
            color: { value: 'teal', actors: ['agent'] }
        }
    },
    'group.arrange': {
        actors: ['person', 'voice'],
        input: { viewId: 'board', groupId: 'group-1' },
        refused: { 'an empty group': { viewId: 'board', groupId: '' } }
    },
    'canvas.fit': {
        actors: ['person', 'voice', 'automation'],
        input: { viewId: 'board' },
        refused: { 'an empty view': { viewId: '' } }
    },
    'history.undo': {
        actors: ['person', 'voice', 'automation'],
        input: { viewId: 'board' },
        refused: { 'no view': {} }
    },
    'history.redo': {
        actors: ['person', 'voice', 'automation'],
        input: { viewId: 'board' },
        refused: { 'no view': {} }
    },
    'canvasText.create': {
        actors: ['person', 'voice'],
        input: { viewId: 'board', text: 'Phase two', at: null },
        refused: { 'blank text': { viewId: 'board', text: ' ', at: null }, 'no place at all': { viewId: 'board', text: 'Phase two' } }
    },
    'node.promoteToView': {
        actors: ['person', 'voice'],
        input: { viewId: 'board', nodeId: 'chat-1' },
        refused: { 'no node': { viewId: 'board' } },
        confirms: true
    },
    'node.moveToView': {
        actors: ['person', 'voice'],
        input: { viewId: 'board', nodeId: 'chat-1', targetViewId: 'archive' },
        refused: { 'no target': { viewId: 'board', nodeId: 'chat-1' }, 'an empty target': { viewId: 'board', nodeId: 'chat-1', targetViewId: '' } },
        confirms: true
    },
    'canvas.setLocks': {
        actors: ['person', 'voice'],
        input: { viewId: 'board', locked: true, gestures: ['pan', 'zoom'] },
        refused: {
            'a gesture the canvas has not': { viewId: 'board', locked: true, gestures: ['rotate'] },
            'an empty list of gestures': { viewId: 'board', locked: true, gestures: [] }
        }
    },
    'node.arrange': {
        actors: ['agent'],
        input: { viewId: 'board', nodeIds: ['chat-1', 'chat-2', 'chat-3'], layout: 'grid', columns: 2 },
        refused: {
            'a layout it has not': { viewId: 'board', nodeIds: ['chat-1'], layout: 'circle', columns: null },
            'no columns at all': { viewId: 'board', nodeIds: ['chat-1'], layout: 'grid', columns: 0 },
            'nothing to arrange': { viewId: 'board', nodeIds: [], layout: 'row', columns: null }
        }
    },
    'link.create': {
        actors: ['person', 'agent'],
        input: { viewId: 'board', from: null, to: ['chat-2'] },
        refused: { 'nowhere to run': { viewId: 'board', from: null, to: [] }, 'an empty start': { viewId: 'board', from: '', to: ['chat-2'] } },
        restricted: {
            label: { value: 'Reviews', actors: ['agent'] },
            role: { value: 'reviewer', actors: ['agent'] }
        }
    },
    'link.delete': {
        actors: ['agent'],
        input: { viewId: 'board', edgeId: 'edge-1' },
        refused: { 'an empty line': { viewId: 'board', edgeId: '' } }
    }
});
