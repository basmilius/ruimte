import { afterAll, expect, test } from 'bun:test';
import { openDevServer, runSmoke, smokeBrowser, smokeNode, warmSmoke } from './testing/dev-smoke';

const dev = smokeBrowser === null || smokeNode === null ? null : await openDevServer({});

if (dev !== null) {
    await warmSmoke(dev.url, 'image-save');
}

afterAll(async () => {
    await dev?.close();
});

test.skipIf(dev === null)(
    'the image save dialog selects project folders and replaces only after the explicit button',
    async () => {
        expect((await runSmoke(dev!.url, 'image-save')).saved).toEqual({
            saveDisabled: true,
            pathShown: true,
            saveBeforeReplace: 0,
            busyStaysOpen: true,
            savedPath: '/project/assets/rabbit.png',
            writes: [
                {
                    type: 'chat.saveImage',
                    payload: { chatId: 'chat-original', attachmentId: 'image-original', path: '/project/assets/rabbit.png', replace: 'checked-image' }
                }
            ]
        });
    },
    30000
);
