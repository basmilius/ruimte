import { type WriteCases } from './case.ts';

const choice = { chatId: 'chat-1', itemId: 'item-1', blockId: 'block-1', revision: 'rev-1', choiceId: 'yes', reads: { plan: 'v2' } };
const attachment = { name: 'shot.png', mime: 'image/png', data: 'iVBORw0KGgo=' };

export const cases: WriteCases = {
    'terminal.clear': {
        actors: ['person', 'voice'],
        input: { terminalId: 'term-1' },
        refused: { 'an empty terminal': { terminalId: '' } },
        confirms: true
    },
    'chat.send': {
        actors: ['person', 'voice', 'automation'],
        input: { chatId: 'chat-1', prompt: 'Run the tests' },
        refused: {
            'an empty chat': { chatId: '', prompt: 'Run the tests' },
            'no prompt': { chatId: 'chat-1' },
            'a delivery it has not': { chatId: 'chat-1', prompt: 'Now', delivery: 'interrupt' },
            'more than eight attachments': { chatId: 'chat-1', prompt: '', attachments: Array.from({ length: 9 }, () => attachment) }
        },
        restricted: {
            delivery: { value: 'queue', actors: ['person', 'voice'] },
            mentions: { value: ['apps/server/src/daemon.ts'], actors: ['person'] },
            skills: { value: ['review'], actors: ['person'] },
            chats: { value: ['chat-2'], actors: ['person'] },
            quoteSource: { value: { itemId: 'item-9' }, actors: ['person'] },
            attachments: { value: [attachment], actors: ['person'] },
            references: { value: ['view-2'], actors: ['person'] }
        }
    },
    'chat.uiChoice': {
        actors: ['person'],
        input: choice,
        refused: {
            'no choice': { ...choice, choiceId: '' },
            'an item id past its limit': { ...choice, itemId: 'x'.repeat(257) },
            'no revision': { chatId: 'chat-1', itemId: 'item-1', blockId: 'block-1', choiceId: 'yes' }
        }
    },
    'chat.clear': {
        actors: ['person', 'voice'],
        input: { chatId: 'chat-1' },
        refused: { 'an empty chat': { chatId: '' } },
        restricted: {
            force: { value: true, actors: ['person'] }
        },
        confirms: true
    },
    'agent.alert': {
        actors: ['agent'],
        input: { text: 'The release is out' },
        refused: { 'blank text': { text: '  ' }, 'text past its limit': { text: 'x'.repeat(501) } }
    },
    'agent.notify': {
        actors: ['agent'],
        input: { nodeId: 'chat-2', text: 'The schema changed, read it again' },
        refused: {
            'empty text': { nodeId: 'chat-2', text: '' },
            'no node': { text: 'Hello' }
        }
    },
    'visual.write': {
        actors: ['agent'],
        input: { name: 'chart.html', html: '<!doctype html><p>Chart</p>' },
        refused: { 'no page': { name: 'chart.html' } }
    },
    'visual.show': {
        actors: ['agent'],
        input: { title: 'Usage', html: '<!doctype html><p>Usage</p>', maxHeight: null, layout: 'wide' },
        refused: {
            'a layout it has not': { title: 'Usage', html: '<p></p>', maxHeight: null, layout: 'full' },
            'no height at all': { title: 'Usage', html: '<p></p>' }
        }
    },
    'visual.remove': {
        actors: ['agent'],
        input: { visualId: 'visual-1' },
        refused: { 'an empty visual': { visualId: '' } }
    },
    'chat.attach': {
        actors: ['agent'],
        input: { name: 'shot.png', data: 'iVBORw0KGgo=' },
        refused: { 'no bytes': { name: 'shot.png', data: '' }, 'no name': { name: ' ', data: 'iVBORw0KGgo=' } }
    }
};
