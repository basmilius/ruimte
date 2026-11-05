import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { callerFolders } from './caller-folders.ts';

const HOME = '/home/someone/.ruimte';

describe('callerFolders', () => {
    test('a caller gets its attachments and its visuals workspace', () => {
        expect(callerFolders(HOME, 'chat-1')).toEqual([join(HOME, 'attachments', 'chat-1'), join(HOME, 'chats', 'chat-1.visuals')]);
    });

    test.each(['..', '.', '../x', '../../etc', 'a/b'])('a caller %p never names a folder outside the stores', (caller) => {
        const parents = callerFolders(HOME, caller).map((folder) => dirname(folder));

        expect(parents).toEqual([join(HOME, 'attachments'), join(HOME, 'chats')]);
    });
});
