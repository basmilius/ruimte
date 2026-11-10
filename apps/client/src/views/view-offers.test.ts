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
    filePath: null,
    written: true,
    moves: true
};

describe('what a view offers', () => {
    test('a chat in a project offers its folder and a place in the shared file', () => {
        expect(viewOffers(chat)).toMatchObject({ reveal: true, share: true });
    });

    test('a database view is no node, so it is never offered a place on the canvas', () => {
        expect(viewOffers({ ...chat, kind: 'database', hasCanvas: true })).toMatchObject({ putOnCanvas: false, share: true });
        expect(viewOffers({ ...chat, kind: 'chat', hasCanvas: true })).toMatchObject({ putOnCanvas: true });
    });

    test('a chat in the Chats project offers neither', () => {
        expect(viewOffers({ ...chat, scratch: true })).toMatchObject({ reveal: false, share: false });
    });

    test('a written chat in the Chats project can become a project or move into one', () => {
        expect(viewOffers({ ...chat, scratch: true })).toMatchObject({ makeProject: true, moveToProject: true });
    });

    test('a chat nobody wrote in has nothing to move', () => {
        expect(viewOffers({ ...chat, scratch: true, written: false })).toMatchObject({ makeProject: false, moveToProject: false });
    });

    test('a chat outside the Chats project is already in one', () => {
        expect(viewOffers(chat)).toMatchObject({ makeProject: false, moveToProject: false });
    });

    test('a machine that does not answer chat.move offers neither', () => {
        expect(viewOffers({ ...chat, scratch: true, moves: false })).toMatchObject({ makeProject: false, moveToProject: false });
    });

    test('only a chat moves', () => {
        expect(viewOffers({ ...chat, kind: 'terminal', scratch: true })).toMatchObject({ makeProject: false, moveToProject: false });
    });
});
