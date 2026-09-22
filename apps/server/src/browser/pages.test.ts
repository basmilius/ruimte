import { describe, expect, test } from 'bun:test';
import type { BrowserPageState } from '@ruimte/contracts';
import type { SessionEvent } from '../sessions/manager.ts';
import { BrowserPages } from './pages.ts';

const stateOf = (browserId: string, url = 'https://example.com'): BrowserPageState => ({
    browserId,
    url,
    title: 'Example',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null
});

/* A client on its socket, with what it was told and a hand to answer with. */
const clientOf = (pages: BrowserPages, clientId: string): { events: SessionEvent[]; stop: () => void } => {
    const events: SessionEvent[] = [];
    const stop = pages.subscribe(clientId, (event) => events.push(event));
    return { events, stop };
};

describe('BrowserPages', () => {
    test('a page nobody holds is a null, which is what lets a verb say nobody is watching', async () => {
        const pages = new BrowserPages();
        expect(await pages.drive('page-1', { kind: 'back' })).toBeNull();
        expect(pages.state('page-1')).toBeNull();
    });

    test('an ask reaches every client holding that page, and the first answer is the one it takes', async () => {
        const pages = new BrowserPages();
        const first = clientOf(pages, 'client-1');
        const second = clientOf(pages, 'client-2');
        pages.hold('client-1', stateOf('page-1'));
        pages.hold('client-2', stateOf('page-1'));

        const driving = pages.drive('page-1', { kind: 'go', url: 'https://example.com/two' });
        const asked = first.events.at(-1);
        expect(asked).toMatchObject({ event: 'browser.drive', payload: { browserId: 'page-1', action: { kind: 'go', url: 'https://example.com/two' } } });
        expect(second.events).toHaveLength(1);

        const askId = (asked!.payload as { askId: string }).askId;
        pages.settle({ askId, state: stateOf('page-1', 'https://example.com/two') });
        pages.settle({ askId, state: stateOf('page-1', 'https://example.com/three') });
        expect((await driving)?.state?.url).toBe('https://example.com/two');
    });

    test('a client that never answers leaves the agent with what that client last reported', async () => {
        const pages = new BrowserPages(0);
        clientOf(pages, 'client-1');
        pages.hold('client-1', stateOf('page-1'));

        const outcome = await pages.drive('page-1', { kind: 'reload' });
        expect(outcome?.state?.url).toBe('https://example.com');
        expect(outcome?.error).toBe('The page did not answer in time');
    });

    test('a shot comes back as the bytes it was sent as', async () => {
        const pages = new BrowserPages();
        const client = clientOf(pages, 'client-1');
        pages.hold('client-1', stateOf('page-1'));

        const driving = pages.drive('page-1', { kind: 'shot' });
        const askId = (client.events.at(-1)!.payload as { askId: string }).askId;
        pages.settle({ askId, image: Buffer.from('png').toString('base64') });
        expect(Buffer.from((await driving)!.image!).toString()).toBe('png');
    });

    test('a page released, and a client that went away, are pages nobody holds any more', async () => {
        const pages = new BrowserPages();
        clientOf(pages, 'client-1');
        pages.hold('client-1', stateOf('page-1'));
        pages.hold('client-1', stateOf('page-2'));

        pages.release('client-1', 'page-1');
        expect(pages.state('page-1')).toBeNull();
        expect(pages.state('page-2')).not.toBeNull();

        pages.detachAll('client-1');
        expect(pages.state('page-2')).toBeNull();
    });
});
