import { describe, expect, test } from 'bun:test';
import { inlineDesignPage, runtimeAssets, type DesignFiles } from './design-inline';
import { DESIGN_PAGE_MAX_BYTES, pageDataUrl } from './design-page';

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
