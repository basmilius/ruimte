import { describe, expect, test } from 'bun:test';
import { DESIGN_ASSET_METHOD, withRuntimeAssets } from './design-page.ts';

type Listener = (event: { source: unknown; origin: string; data: unknown }) => void;

class StandInElement {
    readonly nodeType = 1;
    readonly attributes = new Map<string, string>();
    readonly localName: string;

    constructor(localName: string) {
        this.localName = localName;
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    querySelectorAll(): StandInElement[] {
        return [];
    }
}

/* The script that shows what a page's script names while it runs, run against a stand-in window framed in `parent`. */
function running(from: string, framedIn: 'stage' | 'nothing' | 'host' = 'stage', hostBytes: Record<string, Blob> = {}) {
    const script = /<script data-ruimte-assets>([\s\S]*?)<\/script>/.exec(withRuntimeAssets('<head></head>', from))![1]!;
    const asked: unknown[] = [];
    const frames: { posted: unknown[]; postMessage(message: unknown): void }[] = [];
    const listeners: Listener[] = [];
    let observed: ((records: object[]) => void) | null = null;
    let made = 0;
    const parent = { postMessage: (message: unknown) => asked.push(message) };
    const hostAsked: string[] = [];
    const window: { frames: typeof frames; parent: unknown; ruimteHost?: { asset(path: string): Promise<Blob | null> } } = {
        frames,
        parent: framedIn === 'stage' ? parent : null
    };

    if (framedIn !== 'stage') {
        window.parent = window;
    }

    if (framedIn === 'host') {
        window.ruimteHost = {
            asset: (path) => {
                hostAsked.push(path);

                return Promise.resolve(hostBytes[path] ?? null);
            }
        };
    }

    class StandInObserver {
        constructor(callback: (records: object[]) => void) {
            observed = callback;
        }

        observe(): void {}
    }

    new Function('window', 'document', 'addEventListener', 'MutationObserver', 'URL', 'Blob', script)(
        window,
        { documentElement: {} },
        (_type: string, listener: Listener) => listeners.push(listener),
        StandInObserver,
        { createObjectURL: () => `blob:null/${++made}` },
        Blob
    );

    const settle = async (): Promise<void> => {
        for (let i = 0; i < 10; i++) {
            await Promise.resolve();
        }
    };

    return {
        asked,
        hostAsked,
        observing: () => observed !== null,
        frame: () => {
            const frame = { posted: [] as unknown[], postMessage: (message: unknown) => frame.posted.push(message) };
            frames.push(frame);

            return frame;
        },
        set: async (element: StandInElement, name: string, value: string) => {
            element.setAttribute(name, value);
            observed?.([{ type: 'attributes', target: element, attributeName: name }]);
            await settle();
        },
        hear: async (source: unknown, origin: string, data: unknown) => {
            listeners.forEach((listener) => listener({ source, origin, data }));
            await settle();
        },
        answer: async (path: string, bytes: Blob | null) => {
            listeners.forEach((listener) =>
                listener({ source: parent, origin: 'https://ruimte.app', data: { jsonrpc: '2.0', method: DESIGN_ASSET_METHOD, params: { path, bytes } } })
            );
            await settle();
        }
    };
}

const asset = (path: string) => ({ jsonrpc: '2.0', method: DESIGN_ASSET_METHOD, params: { path } });

describe('a file a design page names while it runs', () => {
    test('is asked by its path in the folder and shown from the bytes that come back, with its fragment', async () => {
        const page = running('flows');
        const image = new StandInElement('img');

        await page.set(image, 'src', ' ../assets/work/apple.png?v=2#icon ');
        expect(page.asked).toEqual([asset('assets/work/apple.png')]);
        expect(image.getAttribute('src')).toBe(' ../assets/work/apple.png?v=2#icon ');

        await page.answer('assets/work/apple.png', new Blob(['png'], { type: 'image/png' }));
        expect(image.getAttribute('src')).toBe('blob:null/1#icon');
    });

    test('is asked once however often it is named, also in a srcset and in a style', async () => {
        const page = running('');
        const image = new StandInElement('img');
        const card = new StandInElement('div');

        await page.set(image, 'srcset', 'a.png 1x, b.png 2x, https://example.com/c.png 3x');
        await page.set(card, 'style', 'background: url("a.png") center, url(data:image/png;base64,AA)');
        await page.answer('a.png', new Blob(['a']));
        await page.answer('b.png', new Blob(['b']));

        expect(page.asked).toEqual([asset('a.png'), asset('b.png')]);
        expect(image.getAttribute('srcset')).toBe('blob:null/1 1x, blob:null/2 2x, https://example.com/c.png 3x');
        expect(card.getAttribute('style')).toBe('background: url("blob:null/1") center, url(data:image/png;base64,AA)');
    });

    test('is not asked for when it leaves the folder, is a page or is an address of its own, and stays as it is without bytes', async () => {
        const page = running('');
        const image = new StandInElement('img');

        for (const src of ['../outside.png', 'next.html', 'https://example.com/a.png', 'data:image/png;base64,AA', '#top', '/root.png']) {
            await page.set(image, 'src', src);
        }
        await page.set(new StandInElement('iframe'), 'src', 'framed.png');
        expect(page.asked).toEqual([]);

        await page.set(image, 'src', 'gone.png');
        await page.answer('gone.png', null);
        expect(image.getAttribute('src')).toBe('gone.png');
    });

    test('is asked of the page above for a page framed in it, and handed down only to a frame of its own on an opaque origin', async () => {
        const page = running('');
        const framed = page.frame();
        const web = { posted: [] as unknown[], postMessage: () => undefined };
        const bytes = new Blob(['svg'], { type: 'image/svg+xml' });

        await page.hear(framed, 'null', asset('assets/logo.svg'));
        await page.hear(framed, 'null', asset('assets/logo.svg'));
        await page.hear(web, 'null', asset('assets/other.svg'));
        await page.hear(framed, 'https://example.com', asset('assets/other.svg'));
        expect(page.asked).toEqual([asset('assets/logo.svg')]);

        await page.answer('assets/logo.svg', bytes);
        expect(framed.posted).toEqual([
            { jsonrpc: '2.0', method: DESIGN_ASSET_METHOD, params: { path: 'assets/logo.svg', bytes } },
            { jsonrpc: '2.0', method: DESIGN_ASSET_METHOD, params: { path: 'assets/logo.svg', bytes } }
        ]);
    });

    test('is not asked for when a backslash or an escape takes it out of the folder, and a backslash between folders is a slash', async () => {
        const page = running('flows');
        const image = new StandInElement('img');

        for (const src of [
            '..\\..\\private.txt',
            'a\\..\\..\\..\\x',
            'C:\\x',
            '\\\\server\\share\\x',
            '%2e%2e/%2e%2e/x',
            '..%2f..%2fx',
            '%5c..%5cx',
            'a%00.png'
        ]) {
            await page.set(image, 'src', src);
        }
        expect(page.asked).toEqual([]);

        await page.set(image, 'src', '..\\assets\\logo.svg');
        expect(page.asked).toEqual([asset('assets/logo.svg')]);
    });

    test('is left alone in a page on its own, as Export hands it out', () => {
        expect(running('', 'nothing').observing()).toBe(false);
    });

    test('is asked of the host of a page that has no window above it, as the iPhone app shows it, and handed down to the pages it frames', async () => {
        const bytes = new Blob(['png'], { type: 'image/png' });
        const page = running('', 'host', { 'assets/work/apple.png': bytes });
        const image = new StandInElement('img');
        const framed = page.frame();

        await page.set(image, 'src', 'assets/work/apple.png');
        expect(page.hostAsked).toEqual(['assets/work/apple.png']);
        expect(page.asked).toEqual([]);
        expect(image.getAttribute('src')).toBe('blob:null/1');

        await page.hear(framed, 'null', asset('assets/work/apple.png'));
        expect(page.hostAsked).toEqual(['assets/work/apple.png']);
        expect(framed.posted).toEqual([{ jsonrpc: '2.0', method: DESIGN_ASSET_METHOD, params: { path: 'assets/work/apple.png', bytes } }]);
    });
});
