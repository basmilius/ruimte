import { describe, expect, test } from 'bun:test';
import { DESIGN_METHODS, designPageMessage, tweaksOf } from './design-protocol';
import { DESIGN_RUNTIME, withDesignRuntime, withRuntimeAssets } from './design-runtime';

const element = {
    selector: '#2a > a:nth-of-type(1)',
    option: '2a',
    name: 'a.cta',
    html: '<a class="cta">Open</a>',
    text: 'Open',
    rect: { x: 10, y: 20, width: 114, height: 34 },
    style: { color: 'rgb(255, 255, 255)' }
};

describe('the runtime of a design page', () => {
    test('runs at the end of the body, after the markup it works on, or at the end of a page without one', () => {
        const page = withDesignRuntime('<html><body><div id="1a"></div></body></html>');

        expect(page.indexOf('data-ruimte-design')).toBeGreaterThan(page.indexOf('id="1a"'));
        expect(page.endsWith('</script></body></html>')).toBe(true);
        expect(withDesignRuntime('<p>bare</p>').startsWith('<p>bare</p><script data-ruimte-design>')).toBe(true);
    });

    test('is a script a browser can parse', () => {
        expect(() => new Function(DESIGN_RUNTIME)).not.toThrow();
    });
});

describe('what a design page may say', () => {
    test('is heard only in the shapes of the protocol, with a camera that makes sense', () => {
        expect(designPageMessage({ jsonrpc: '2.0', method: DESIGN_METHODS.ready, params: { canvas: true, tweaks: null } })).toMatchObject({
            params: { canvas: true }
        });
        expect(designPageMessage({ jsonrpc: '2.0', method: DESIGN_METHODS.camera, params: { x: -40, y: 12, zoom: 0.5 } })).toMatchObject({
            params: { zoom: 0.5 }
        });
        expect(designPageMessage({ jsonrpc: '2.0', method: DESIGN_METHODS.camera, params: { x: 0, y: 0, zoom: 0 } })).toBeNull();
        expect(designPageMessage({ jsonrpc: '2.0', method: DESIGN_METHODS.pick, params: { tool: 'comment', element } })).toMatchObject({
            params: { element: { option: '2a' } }
        });
        expect(designPageMessage({ jsonrpc: '2.0', method: DESIGN_METHODS.pick, params: { tool: 'draw', element } })).toBeNull();
        expect(designPageMessage({ jsonrpc: '2.0', method: DESIGN_METHODS.text, params: { element, before: 'Open', after: 'Open a project' } })).not.toBeNull();
        expect(designPageMessage({ jsonrpc: '2.0', method: 'ui/open-link', params: { url: 'https://example.com' } })).toBeNull();
        expect(designPageMessage('ruimte/design/ready')).toBeNull();
    });

    test('declares tweaks the panel can draw, and a declaration that does not hold gives no panel at all', () => {
        const declared = {
            accent: { label: 'Accent', type: 'color', options: ['#5b5bd6', '#e5484d'], value: '#5b5bd6' },
            density: { type: 'range', min: 0.6, max: 1.2, step: 0.05, value: 0.9 },
            nav: { type: 'select', options: ['tabs', 'sidebar'], value: 'tabs' }
        };

        expect(tweaksOf(declared)).toEqual(declared as never);
        expect(tweaksOf({ 'bad name': { type: 'toggle', value: true } })).toBeNull();
        expect(tweaksOf({ accent: { type: 'gradient', value: 'x' } })).toBeNull();
        expect(tweaksOf({})).toBeNull();
        expect(tweaksOf(null)).toBeNull();
    });

    test('asks only for a file inside its folder, by the path the folder holds it at, and never for a page', () => {
        const asking = (path: unknown) => designPageMessage({ jsonrpc: '2.0', method: DESIGN_METHODS.asset, params: { path } });

        expect(asking('assets/work/apple.png')).toMatchObject({ params: { path: 'assets/work/apple.png' } });
        for (const path of [
            '../secret.png',
            'assets/../../secret.png',
            'assets/./a.png',
            '/etc/hosts',
            'https://example.com/a.png',
            'a.png?v=1',
            'next.html',
            '',
            7
        ]) {
            expect(asking(path)).toBeNull();
        }
        expect(asking(`${'a/'.repeat(600)}a.png`)).toBeNull();
    });
});

type Listener = (event: { source: unknown; origin: string; data: unknown }) => void;

/* A stand-in element that keeps its attributes. */
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
function running(from: string, framedIn: 'stage' | 'nothing' = 'stage') {
    const script = /<script data-ruimte-assets>([\s\S]*?)<\/script>/.exec(withRuntimeAssets('<head></head>', from))![1]!;
    const asked: unknown[] = [];
    const frames: { posted: unknown[]; postMessage(message: unknown): void }[] = [];
    const listeners: Listener[] = [];
    let observed: ((records: object[]) => void) | null = null;
    let made = 0;
    const parent = { postMessage: (message: unknown) => asked.push(message) };
    const window = { frames, parent: framedIn === 'stage' ? parent : null };

    if (framedIn === 'nothing') {
        window.parent = window as never;
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
                listener({ source: parent, origin: 'https://ruimte.app', data: { jsonrpc: '2.0', method: DESIGN_METHODS.asset, params: { path, bytes } } })
            );
            await settle();
        }
    };
}

const asset = (path: string) => ({ jsonrpc: '2.0', method: DESIGN_METHODS.asset, params: { path } });

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
            { jsonrpc: '2.0', method: DESIGN_METHODS.asset, params: { path: 'assets/logo.svg', bytes } },
            { jsonrpc: '2.0', method: DESIGN_METHODS.asset, params: { path: 'assets/logo.svg', bytes } }
        ]);
    });

    test('is left alone in a page on its own, as Export hands it out', () => {
        expect(running('', 'nothing').observing()).toBe(false);
    });
});
