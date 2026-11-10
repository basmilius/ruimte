import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chatAttachmentsFolder, chatVisualsFolder, computerUseScreenshots, HOME_FOLDERS, homeFolder, localKeyPath } from './home';

describe('the layout of $RUIMTE_HOME', () => {
    test('names the secret and the folders under the home', () => {
        expect(localKeyPath('/home/r')).toBe(join('/home/r', 'local.key'));
        expect(homeFolder('/home/r', 'worktrees')).toBe(join('/home/r', 'worktrees'));
        expect(computerUseScreenshots('/home/r')).toBe(join('/home/r', 'computer-use', 'screenshots'));
    });

    test('gives every folder a name of its own, so two cannot be one', () => {
        const names = Object.values(HOME_FOLDERS);
        expect(new Set(names).size).toBe(names.length);
    });

    test('keeps a chat in a folder of its own, however odd its id', () => {
        expect(chatVisualsFolder('/home/r', 'chat-1')).toBe(join('/home/r', 'chats', 'chat-1.visuals'));
        expect(chatVisualsFolder('/home/r', 'chat/1')).toBe(join('/home/r', 'chats', 'chat%2F1.visuals'));
        expect(chatAttachmentsFolder('/home/r', 'chat-1')).toBe(join('/home/r', 'attachments', 'chat-1'));
        expect(chatAttachmentsFolder('/home/r', '..')).toBe(join('/home/r', 'attachments', '%2E%2E'));
    });
});
