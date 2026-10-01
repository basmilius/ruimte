import { describe, expect, test } from 'bun:test';
import { viewOffers, type ViewOffersInput } from './view-offers';

const chat: ViewOffersInput = {
    kind: 'chat',
    shared: false,
    canShare: true,
    hasCanvas: false,
    onCanvas: false,
    offersFork: false,
    asChat: null,
    asTerminal: null,
    workingFolder: '/home/ada/.ruimte/scratch/chat-1',
    filePath: null
};

describe('what a view offers', () => {
    test('a chat in a project offers its folder and a place in the shared file', () => {
        expect(viewOffers(chat)).toMatchObject({ reveal: true, share: true });
    });

    test('a chat in the Chats project offers neither', () => {
        expect(viewOffers({ ...chat, scratch: true })).toMatchObject({ reveal: false, share: false });
    });
});
