import { describe, expect, test } from 'bun:test';
import { assetPathOf, assetReferences, isPagePath, pageDataUrl, pageMentions, withAssets, withFramedPages } from './design-page.ts';

describe('a reference a page makes to its folder', () => {
    test('names a file inside the folder, and nothing for the web, inline bytes, a fragment or a path that leaves it', () => {
        expect(assetPathOf('assets/logo.svg')).toBe('assets/logo.svg');
        expect(assetPathOf('./assets/../hero.png?v=2#top')).toBe('hero.png');
        expect(assetPathOf('assets/my%20photo.jpg')).toBe('assets/my photo.jpg');
        expect(assetPathOf('../secret.txt')).toBeNull();
        expect(assetPathOf('https://cdn.example.com/react.js')).toBeNull();
        expect(assetPathOf('//cdn.example.com/a.css')).toBeNull();
        expect(assetPathOf('data:image/png;base64,AAAA')).toBeNull();
        expect(assetPathOf('#2a')).toBeNull();
        expect(assetPathOf('/etc/passwd')).toBeNull();
        expect(assetPathOf('mailto:bas@example.com')).toBeNull();
    });

    test('keeps a percent sign that starts no escape as it is written, the way a browser asks for it', () => {
        expect(assetPathOf('img/100%.png')).toBe('img/100%.png');
        expect(assetReferences('<img src="img/100%.png">')).toEqual(['img/100%.png']);
    });

    test('takes a backslash for a separator and refuses every shape that leaves the folder on a machine that does the same', () => {
        // The same cases run on the iPhone (`DesignInliningTests`), which hands the path to a machine that may be Windows.
        expect(assetPathOf('assets\\logo.svg')).toBe('assets/logo.svg');
        expect(assetPathOf('..\\assets\\logo.svg', 'flows')).toBe('assets/logo.svg');
        expect(assetPathOf('assets/a%20b.png')).toBe('assets/a b.png');

        for (const reference of [
            '..\\private.txt',
            'a\\..\\..\\x',
            'C:\\x',
            '\\\\server\\share\\x',
            '\\x',
            '%2e%2e/x',
            '%2e%2e%2fx',
            'a%2f..%2f..%2fx',
            '%5c..%5cx',
            '%5c%5cserver%5cshare',
            '%2fetc/x',
            '%43:/x',
            '/etc/x',
            'a%00b.png',
            'a/.../x',
            'a/.. /x'
        ]) {
            expect(assetPathOf(reference)).toBeNull();
        }
        expect(assetPathOf('..\\..\\x', 'flows')).toBeNull();
    });

    test('is found in an attribute and in CSS, once each, and replaced by its bytes where it has them', () => {
        const html = [
            '<link rel="stylesheet" href="styles.css">',
            '<img src="assets/logo.svg"><img src=\'assets/logo.svg\'>',
            '<a href="#2b">2b</a><script src="https://cdn.example.com/x.js"></script>',
            '<div style="background: url(assets/bg.png)"></div><video poster="missing.jpg"></video>'
        ].join('');

        expect(assetReferences(html)).toEqual(['styles.css', 'assets/logo.svg', 'missing.jpg', 'assets/bg.png']);

        const inline = new Map([
            ['styles.css', 'data:text/css;base64,Ym9keXt9'],
            ['assets/logo.svg', 'data:image/svg+xml;base64,PHN2Zy8+'],
            ['assets/bg.png', 'data:image/png;base64,AAAA']
        ]);
        const result = withAssets(html, inline);

        expect(result).toContain('href="data:text/css;base64,Ym9keXt9"');
        expect(result).toContain('<img src="data:image/svg+xml;base64,PHN2Zy8+"><img src=\'data:image/svg+xml;base64,PHN2Zy8+\'>');
        expect(result).toContain('url(data:image/png;base64,AAAA)');
        expect(result).toContain('poster="missing.jpg"');
        expect(result).toContain('href="#2b"');
        expect(result).toContain('src="https://cdn.example.com/x.js"');
    });

    test('from a page in a folder of its own stands beside that page, and still never leaves the design folder', () => {
        expect(assetPathOf('../assets/logo.svg', 'flows')).toBe('assets/logo.svg');
        expect(assetPathOf('step.html', 'flows/signup')).toBe('flows/signup/step.html');
        expect(assetPathOf('../../secret.txt', 'flows')).toBeNull();
        expect(assetReferences('<img src="../logo.svg">', 'flows')).toEqual(['../logo.svg']);
    });
});

/* Runs the script a page frames pages with against stand-ins for the DOM, the way the frame's page would. */
function framing(html: string) {
    class StandInElement {
        readonly attributes = new Map<string, string>();

        setAttribute(name: string, value: string): void {
            this.attributes.set(name, value);
        }
    }

    class StandInFrame extends StandInElement {
        loaded = '';

        get src(): string {
            return this.loaded;
        }

        set src(value: string) {
            this.loaded = value;
        }
    }

    const script = /<script data-ruimte-pages>([\s\S]*?)<\/script>/.exec(html)![1]!;

    new Function('HTMLIFrameElement', 'Element', script)(StandInFrame, StandInElement);

    return { frame: new StandInFrame(), element: new StandInElement() };
}

describe('a page a design page frames', () => {
    test('is a page by its extension, and is named by a page in an attribute or only inside its script', () => {
        const html = '<iframe src="bas.dev.html"></iframe><script>frame.src = `bas.dev.html?theme=${theme}`; open("flows/step-2.html");</script>';

        expect(isPagePath('Overview.HTM')).toBe(true);
        expect(isPagePath('assets/logo.svg')).toBe(false);
        expect(pageMentions(html)).toEqual(['bas.dev.html', 'flows/step-2.html']);
        expect(pageMentions('a backup in notes.html.bak')).toEqual([]);
    });

    test('is found in a run of name characters as long as a page without trying again from every character of it', () => {
        // A scan that retries from every character of the run takes minutes here.
        const run = 'A'.repeat(900_000);

        expect(pageMentions(run)).toEqual([]);
        expect(pageMentions(`${run}.html`)).toEqual([`${run}.html`]);
        expect(pageMentions(`<p>${run}</p> a.html`)).toEqual(['a.html']);
    });

    test('is found as it always was: the longest name a run holds that ends in .htm or .html on its own', () => {
        const mentions = /[\w%./-]+\.html?(?![\w-]|\.\w)/gi;
        const alphabet = ['a', 'B', '1', '.', 'h', 't', 'm', 'l', 'H', 'T', 'M', 'L', '/', '-', '_', '%', '"', ' ', '\n', 'é'];
        let seed = 7;
        const next = (): number => {
            seed = (seed * 48271) % 2147483647;

            return seed;
        };

        for (const text of [
            'a.html/b.html',
            '.html',
            'a.html-',
            'a.htmlx',
            'a.htm.html',
            'a.html.b',
            'a.html..',
            'a.html.-b',
            'x/.html',
            'a.HTM b.Html',
            'a.html%',
            'é.html',
            'a.ht'
        ]) {
            expect(pageMentions(text)).toEqual([...new Set(text.match(mentions) ?? [])]);
        }

        for (let i = 0; i < 3000; i++) {
            const text = Array.from({ length: 1 + (next() % 16) }, () => alphabet[next() % alphabet.length]!).join('');

            expect(pageMentions(text)).toEqual([...new Set(text.match(mentions) ?? [])]);
        }
    });

    test('stands on its own in an address that keeps every character, and hands its query to the page', () => {
        const html = '<!doctype html>\n<p class="a">100% & more? #1 (yes)\t\\</p>';
        const url = new URL(`${pageDataUrl(html)}?theme=dark#/work`);

        expect(url.search).toBe('?theme=dark');
        expect(url.hash).toBe('#/work');
        expect(decodeURIComponent(url.pathname)).toBe(`text/html;charset=utf-8,${html}<!--`);
        expect(pageDataUrl(html)).not.toMatch(/["'<>\s]/);
    });

    test('stays a path in a link, since no browser opens an inline page from one', () => {
        const page = pageDataUrl('<p>2</p>');
        const result = withAssets('<a href="two.html">2</a><iframe src="two.html"></iframe>', new Map([['two.html', page]]));

        expect(result).toBe(`<a href="two.html">2</a><iframe src="${page}"></iframe>`);
    });

    test('is framed by a script at the start of the head, before any script of the page runs', () => {
        const pages = new Map([['two.html', 'data:text/html;charset=utf-8,two']]);

        expect(withFramedPages('<!doctype html><html><head><title>1</title></head></html>', '', pages)).toMatch(
            /^<!doctype html><html><head><script data-ruimte-pages>[\s\S]*<\/script><title>/
        );
        expect(withFramedPages('<!doctype html><p>1</p>', '', pages)).toMatch(/^<!doctype html><script data-ruimte-pages>/);
        expect(withFramedPages('<p>1</p>', '', new Map())).toBe('<p>1</p>');
    });

    test('loads standing on its own when a script sets a frame to it, with the query and fragment it was given', () => {
        const pages = new Map([
            ['two.html', 'data:text/html;charset=utf-8,two'],
            ['flows/three.html', 'data:text/html;charset=utf-8,three']
        ]);
        const { frame, element } = framing(withFramedPages('<head></head>', 'flows', pages));

        frame.src = '../two.html?theme=dark#/work';
        expect(frame.src).toBe('data:text/html;charset=utf-8,two?theme=dark#/work');

        frame.setAttribute('SRC', './three.html#top');
        expect(frame.attributes.get('SRC')).toBe('data:text/html;charset=utf-8,three#top');

        frame.src = 'https://example.com/two.html';
        expect(frame.src).toBe('https://example.com/two.html');

        frame.src = 'missing.html';
        expect(frame.src).toBe('missing.html');

        element.setAttribute('src', 'three.html');
        expect(element.attributes.get('src')).toBe('three.html');
    });
});
