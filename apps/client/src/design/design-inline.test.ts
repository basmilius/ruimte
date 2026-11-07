import { describe, expect, test } from 'bun:test';
import { inlineDesignPage, runtimeAssets, type DesignFiles } from './design-inline';
import { DESIGN_PAGE_MAX_BYTES, pageDataUrl } from './design-page';
import { runtimeAssetsElement } from './design-runtime';

/* A design folder in memory that counts how often each page is read. */
function folder(pages: Record<string, string>, assets: Record<string, number> = {}) {
    const reads = new Map<string, number>();
    const files: DesignFiles = {
        readPage: async (path) => {
            reads.set(path, (reads.get(path) ?? 0) + 1);

            if (!(path in pages)) {
                throw new Error('not there');
            }

            return { text: pages[path]!, size: pages[path]!.length };
        },
        readAsset: async (path) => {
            if (!(path in assets)) {
                throw new Error('not there');
            }

            return { url: `data:image/png;base64,${path}`, size: assets[path]! };
        }
    };

    return { files, reads };
}

describe('a page that frames another page of its folder', () => {
    test('frames it standing on its own, with its own files and the query and fragment it named', async () => {
        const { files } = folder(
            { 'Overview.html': '<iframe src="site.html?theme=dark#/work"></iframe>', 'site.html': '<img src="assets/me.jpg">' },
            { 'assets/me.jpg': 4 }
        );
        const site = pageDataUrl('<img src="data:image/png;base64,assets/me.jpg">');

        const html = await inlineDesignPage(files, 'Overview.html');

        expect(html).toContain(`<iframe src="${site}?theme=dark#/work"></iframe>`);
        expect(html).toContain('<script data-ruimte-pages>');
        expect(html).toContain(JSON.stringify(site).replace(/</g, '\\u003c'));
    });

    test('reads each page once however often it is named, and never one it is framed in itself', async () => {
        const { files, reads } = folder({
            'Overview.html': '<iframe src="site.html"></iframe><iframe src="site.html"></iframe><script>frame.src = "site.html?x=1";</script>',
            'site.html': '<a href="Overview.html">back</a><iframe src="site.html"></iframe>'
        });

        const html = await inlineDesignPage(files, 'Overview.html');

        expect(reads.get('site.html')).toBe(1);
        expect(reads.get('Overview.html')).toBe(1);
        expect(html).toContain(pageDataUrl('<a href="Overview.html">back</a><iframe src="site.html"></iframe>'));
    });

    test('leaves a page that is not there, or past the bounds of a visual, as the path it was', async () => {
        const big = 'x'.repeat(DESIGN_PAGE_MAX_BYTES);
        const { files } = folder({ 'Overview.html': '<iframe src="gone.html"></iframe><iframe src="big.html"></iframe>', 'big.html': big });

        const html = await inlineDesignPage(files, 'Overview.html');

        expect(html).toBe('<iframe src="gone.html"></iframe><iframe src="big.html"></iframe>');
    });
});

/* What a page weighs once the frame has it: its bytes as the frame writes them. */
const weight = (html: string): number => new TextEncoder().encode(html).length;

describe('what a standing page builds', () => {
    test('stays within the bounds of a visual however often one page is framed, the rest staying the path they were', async () => {
        const child = 'A '.repeat(450_000);
        const { files, reads } = folder({ 'index.html': '<iframe src="child.html"></iframe>'.repeat(20), 'child.html': child });

        const html = await inlineDesignPage(files, 'index.html');

        expect(weight(html)).toBeLessThanOrEqual(DESIGN_PAGE_MAX_BYTES);
        expect(reads.get('child.html')).toBe(1);
        expect(html).toContain(`<iframe src="${pageDataUrl(child)}"></iframe>`);
        expect(html).toContain('<iframe src="child.html"></iframe>');
    });

    test('stays within the bounds of a visual however often one file is named, the rest staying the path they were', async () => {
        const url = `data:image/png;base64,${'A'.repeat(1_000_000)}`;
        const files: DesignFiles = {
            readPage: async () => {
                const text = '<img src="a.png">'.repeat(40);

                return { text, size: weight(text) };
            },
            readAsset: async () => ({ url, size: 750_000 })
        };

        const html = await inlineDesignPage(files, 'index.html');

        expect(weight(html)).toBeLessThanOrEqual(DESIGN_PAGE_MAX_BYTES);
        expect(html).toContain(`<img src="${url}">`);
        expect(html).toContain('<img src="a.png">');
    });

    test('counts a page again each time it stands in another, however deep the pages are framed', async () => {
        const { files, reads } = folder({
            'index.html': '<iframe src="middle.html"></iframe>'.repeat(20),
            'middle.html': '<iframe src="leaf.html"></iframe>'.repeat(20),
            'leaf.html': 'A '.repeat(50_000)
        });

        const html = await inlineDesignPage(files, 'index.html');

        expect(weight(html)).toBeLessThanOrEqual(DESIGN_PAGE_MAX_BYTES);
        expect(reads.get('middle.html')).toBe(1);
        expect(reads.get('leaf.html')).toBe(1);
        expect(html).toContain('<iframe src="data:text/html;charset=utf-8,');
        expect(html).toContain('<iframe src="middle.html"></iframe>');
    });

    test('puts every page that fits where it was named, with the page that frames it and nothing left over', async () => {
        const { files } = folder({ 'index.html': '<iframe src="one.html"></iframe><iframe src="one.html"></iframe>', 'one.html': '<p>one</p>' });

        const html = await inlineDesignPage(files, 'index.html');

        expect(html.split(pageDataUrl('<p>one</p>')).length - 1).toBe(3);
        expect(html).not.toContain('one.html"></iframe>');
    });
});

describe('a page with a script at the bounds of a visual', () => {
    const script = '<script>void 0</script>';

    /* A page of exactly `bytes` bytes that opens with a script. */
    function scripted(bytes: number): string {
        return script + 'x '.repeat((bytes - script.length) / 2);
    }

    async function build(text: string): Promise<string> {
        const files: DesignFiles = {
            readPage: async () => ({ text, size: weight(text) }),
            readAsset: async () => {
                throw new Error('not there');
            }
        };

        return inlineDesignPage(files, 'index.html');
    }

    test('is refused when it and the script that shows its files do not fit together, rather than built past the bounds', async () => {
        await expect(build(scripted(DESIGN_PAGE_MAX_BYTES - 1 - ((DESIGN_PAGE_MAX_BYTES - 1 - script.length) % 2)))).rejects.toThrow();
    });

    test('is built within the bounds when it fits with that script', async () => {
        const runtime = weight(runtimeAssetsElement(''));
        const text = scripted(DESIGN_PAGE_MAX_BYTES - runtime - ((DESIGN_PAGE_MAX_BYTES - runtime - script.length) % 2));

        const html = await build(text);

        expect(weight(html)).toBeLessThanOrEqual(DESIGN_PAGE_MAX_BYTES);
        expect(html).toStartWith('<script data-ruimte-assets>');
    });

    test('leaves a page it frames as the path it was when that page does not fit with its script', async () => {
        const runtime = weight(runtimeAssetsElement(''));
        const child = scripted(DESIGN_PAGE_MAX_BYTES - runtime + 2);
        const { files } = folder({ 'index.html': '<iframe src="child.html"></iframe>', 'child.html': child });

        const html = await inlineDesignPage(files, 'index.html');

        expect(html).toBe('<iframe src="child.html"></iframe>');
    });
});

describe('a file a page names only while it runs', () => {
    test('is shown by a page with a script and answered by a page that frames one, and a page with neither carries nothing for it', async () => {
        const { files } = folder({
            'Overview.html': '<head></head><iframe src="site.html"></iframe>',
            'site.html': '<head></head><script>image.src = `assets/${name}.png`;</script>',
            'still.html': '<p>still</p>'
        });

        expect(await inlineDesignPage(files, 'Overview.html')).toStartWith('<head><script data-ruimte-assets>');
        expect(await inlineDesignPage(files, 'site.html')).toStartWith('<head><script data-ruimte-assets>');
        expect(await inlineDesignPage(files, 'still.html')).toBe('<p>still</p>');
    });

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
