import { afterEach, beforeEach, expect, test } from 'bun:test';
import { ChatModelView } from '@/chat/ChatModelView';
import { mount, until, type Mounted } from '../../testing/dom';

let page: Mounted;

beforeEach(() => {
    page = mount();
});

afterEach(async () => {
    await page.unmount();
});

test('a Model block in a window that cannot draw 3D says so with the name of the model, and fetches nothing', async () => {
    const fetched: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
        fetched.push(String(input));
        return Promise.reject(new Error('Not fetched here'));
    }) as typeof fetch;
    try {
        await page.render(<ChatModelView scopeId="machine" chatId="chat" attachmentId="agent-1" url="blob:model" label="Bracket" caption="" />);
        await until(() => page.host.textContent?.includes('cannot show 3D') === true);
        expect(page.host.textContent).toBe('Bracket is a 3D model, and this window cannot show 3D.');
        expect(page.host.querySelector('canvas')).toBeNull();
        expect(fetched).toEqual([]);
    } finally {
        globalThis.fetch = realFetch;
    }
});
