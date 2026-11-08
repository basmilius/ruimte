import { MAX_TITLE_LENGTH } from '../index.ts';
import { without, type WriteCases } from './case.ts';

const created = { kind: 'terminal', name: 'Build', url: null, command: null, path: null, provider: 'claude' } as const;

export const cases: WriteCases = {
    'view.focus': {
        actors: ['person', 'voice', 'agent', 'automation'],
        input: { viewId: 'board' },
        refused: { 'an empty view': { viewId: '' }, 'no view': {} }
    },
    'view.rename': {
        actors: ['person', 'voice', 'agent', 'automation'],
        input: { viewId: 'board', name: 'Plan' },
        refused: {
            'a blank name': { viewId: 'board', name: '   ' },
            'a name past the title limit': { viewId: 'board', name: 'x'.repeat(MAX_TITLE_LENGTH + 1) },
            'no view': { name: 'Plan' }
        }
    },
    'view.create': {
        actors: ['person', 'voice', 'agent', 'automation'],
        input: created,
        refused: {
            'a kind nobody may make': { ...created, kind: 'files' },
            'a provider that is no identifier': { ...created, provider: 'Some One' },
            'a blank command': { ...created, command: ' ' },
            'no name at all': without(created, 'name'),
            'a database view in a mode it has not': { ...created, kind: 'database', mode: 'graph' }
        },
        restricted: {
            kind: { value: 'device', actors: ['person'] },
            browserOwner: { value: 'endpoint-2', actors: ['person'] },
            account: { value: 'work', actors: ['person'] },
            after: { value: 'board', actors: ['agent'] },
            device: { value: { platform: 'ios', kind: 'simulator', name: 'iPhone 17', runtime: 'iOS 27.0' }, actors: ['person'] },
            resume: { value: 'session-1', actors: ['person'] },
            cwd: { value: 'apps/server', actors: ['person'] }
        }
    },
    'view.delete': {
        actors: ['person', 'voice', 'agent', 'automation'],
        input: { viewId: 'board' },
        refused: { 'an empty view': { viewId: '' } },
        confirms: true
    },
    'view.duplicate': {
        actors: ['person', 'voice'],
        input: { viewId: 'board' },
        refused: { 'an empty view': { viewId: '' } }
    },
    'view.placeOnCanvas': {
        actors: ['person', 'voice'],
        input: { viewId: 'chat-1', canvasViewId: 'board' },
        refused: { 'no view': {}, 'an empty canvas': { viewId: 'chat-1', canvasViewId: '' } }
    },
    'view.showOnCanvas': {
        actors: ['person', 'voice'],
        input: { viewId: 'sketch' },
        refused: { 'no view': {} }
    },
    'view.share': {
        actors: ['person'],
        input: { viewId: 'board', shared: true },
        refused: { 'no answer to shared': { viewId: 'board' }, 'shared as a word': { viewId: 'board', shared: 'yes' } }
    },
    'view.setIcon': {
        actors: ['person', 'voice', 'agent'],
        input: { viewId: 'board', icon: 'rocket' },
        refused: { 'an empty icon': { viewId: 'board', icon: '' }, 'no icon at all': { viewId: 'board' } }
    },
    'view.move': {
        actors: ['person', 'agent'],
        input: { viewId: 'board', afterViewId: null },
        refused: { 'an empty view to follow': { viewId: 'board', afterViewId: '' }, 'no place at all': { viewId: 'board' } }
    },
    'flag.set': {
        actors: ['person', 'agent'],
        input: { ids: ['board', 'note-1'], color: 'teal' },
        refused: {
            'nothing to flag': { ids: [], color: 'teal' },
            'a color off the palette': { ids: ['board'], color: 'beige' },
            'no color at all': { ids: ['board'] }
        }
    }
};
