import { describe, expect, test } from 'bun:test';
import { DESIGN_PAGE_MAX_BYTES } from '@ruimte/contracts';
import { DESIGN_METHODS, designPageMessage, tweaksOf } from './design-protocol';
import { DESIGN_RUNTIME, runtimeAssets, withDesignRuntime } from './design-runtime';

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
            '..\\private.txt',
            'assets\\logo.svg',
            'a\\..\\..\\x',
            'C:\\x',
            '\\\\server\\share\\x',
            '%2e%2e/x',
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

describe('what the stage reads for a file a page names while it runs', () => {
    test('is read once however often it is asked, and not past the bounds of a visual or when it cannot be read', async () => {
        const reads: string[] = [];
        const read = runtimeAssets(async (path) => {
            reads.push(path);

            if (path === 'gone.png') {
                throw new Error('not there');
            }

            return new Blob([new Uint8Array(path === 'big.png' ? DESIGN_PAGE_MAX_BYTES : 4)]);
        });

        const [first, again] = await Promise.all([read('a.png'), read('a.png')]);

        expect(first?.size).toBe(4);
        expect(again).toBe(first);
        expect(await read('gone.png')).toBeNull();
        expect(await read('big.png')).toBeNull();
        expect(reads).toEqual(['a.png', 'gone.png', 'big.png']);
    });
});
