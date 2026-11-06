import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { AttachmentStore, VisualStore } from '@adecore/agents/chat';
import { localKeyPath } from '@ruimte/service/home';
import { chatFolders, isChatVisualsPath, openHomeFolders, shotFolders, tempFolders } from './agent-folders.ts';
import { MachineHome } from './machine-home.ts';

const HOME = '/home/ruimte';

describe('the folders of a chat', () => {
    // The stores own where a chat's files are; the layout in `@ruimte/service/home` has to name the same folders.
    test('are the ones the attachment and visual stores keep, whatever the chat id', () => {
        const attachments = new AttachmentStore(HOME);
        const visuals = new VisualStore(HOME, attachments);

        for (const chatId of ['chat-1', 'chat 1', 'chat/1', '..', '.', '../x', '../../etc', 'a/b', 'ünï']) {
            expect(chatFolders(HOME, chatId)).toEqual([attachments.folderOf(chatId), visuals.workspacePath(chatId)]);
        }
    });

    test('are told apart from the threads beside them', () => {
        expect(isChatVisualsPath(HOME, join(HOME, 'chats', 'chat-1.visuals', 'chart.html'))).toBe(true);
        expect(isChatVisualsPath(HOME, join(HOME, 'chats', 'chat-1.json'))).toBe(false);
        expect(isChatVisualsPath(HOME, join(HOME, 'elsewhere', 'chat-1.visuals'))).toBe(false);
    });
});

describe('the folders of pictures and the system', () => {
    test('the shots are in the open folders of the home', () => {
        for (const folder of shotFolders(HOME)) {
            expect(openHomeFolders(HOME)).toContain(folder);
        }
    });

    test('the temporary folders include /tmp', () => {
        expect(tempFolders()).toContain('/tmp');
    });
});

describe('what a client may read of the home', () => {
    test('is the open folders and the visuals of a chat, and no secret', async () => {
        const machineHome = new MachineHome(HOME);

        for (const path of [...openHomeFolders(HOME), ...chatFolders(HOME, 'chat-1').slice(1)]) {
            await machineHome.refuse(join(path, 'file.png'));
        }
        await expect(machineHome.refuse(localKeyPath(HOME))).rejects.toThrow('belongs to this machine');
    });
});
