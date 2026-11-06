import { operatedView, type WriteCases } from './case.ts';

export const cases: WriteCases = {
    'browser.navigate': {
        actors: ['person', 'voice', 'agent', 'extension'],
        input: { nodeId: 'browser-1', url: 'https://ruimte.app' },
        refused: { 'an empty address': { nodeId: 'browser-1', url: '' }, 'no node': { url: 'https://ruimte.app' } },
        restricted: operatedView
    },
    'browser.back': {
        actors: ['person', 'voice', 'agent', 'extension'],
        input: { nodeId: 'browser-1' },
        refused: { 'an empty node': { nodeId: '' } },
        restricted: operatedView
    },
    'browser.forward': {
        actors: ['person', 'voice', 'agent', 'extension'],
        input: { nodeId: 'browser-1' },
        refused: { 'an empty node': { nodeId: '' } },
        restricted: operatedView
    },
    'browser.reload': {
        actors: ['person', 'voice', 'agent', 'extension'],
        input: { nodeId: 'browser-1', hard: true },
        refused: { 'no answer to hard': { nodeId: 'browser-1' } },
        restricted: operatedView
    },
    'browser.stop': {
        actors: ['person', 'voice', 'agent'],
        input: { nodeId: 'browser-1' },
        refused: { 'no node': {} },
        restricted: operatedView
    }
};
