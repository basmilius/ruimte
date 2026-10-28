import { describe, expect, test } from 'bun:test';
import type { FsEntry } from '@ruimte/contracts';
import {
    arrangePages,
    assetPathOf,
    assetReferences,
    changeReaches,
    designFiles,
    isPagePath,
    layoutPoint,
    pageDataUrl,
    pageMentions,
    pageName,
    pagesByChange,
    strokesBox,
    withAssets,
    withFramedPages
} from './design-page';

function entry(name: string, kind: FsEntry['kind'] = 'file'): FsEntry {
    return { name, path: `/repo/designs/onboarding/${name}`, kind, size: 1, mtime: 0, hidden: false, ignored: false };
}

describe('the pages of a design', () => {
    test('are the HTML files of its folder in the order a person reads names, without folders or other files', () => {
        const entries = [
            entry('Pricing.html'),
            entry('assets', 'directory'),
            entry('Onboarding v10.html'),
            entry('Onboarding v2.html'),
            entry('notes.md'),
            entry('Old.HTM')
        ];

        expect(designFiles(entries)).toEqual(['Old.HTM', 'Onboarding v2.html', 'Onboarding v10.html', 'Pricing.html']);
    });

    test('stand beside a design node the most recently changed first, and by name when changed at once', () => {
        const at = (name: string, mtime: number): FsEntry => ({ ...entry(name), mtime });
        const entries = [at('1a Calm.html', 100), at('2a Dense.html', 300), at('assets', 50), at('1b Bold.html', 100), at('notes.md', 900)];

        expect(pagesByChange(entries)).toEqual(['2a Dense.html', '1a Calm.html', '1b Bold.html']);
    });

    test('go by their file name without the extension', () => {
        expect(pageName('Skills website.html')).toBe('Skills website');
        expect(pageName('Old.HTM')).toBe('Old');
        expect(pageName('notes.html.bak')).toBe('notes.html.bak');
    });
});

describe('a drawing over the stage', () => {
    test('is cut to its strokes with room around them, and never past the edge of the layer', () => {
        expect(strokesBox([], { width: 800, height: 600 })).toBeNull();
        expect(
            strokesBox(
                [
                    [
                        { x: 100, y: 100 },
                        { x: 200, y: 150 }
                    ],
                    [{ x: 790, y: 10 }]
                ],
                { width: 800, height: 600 }
            )
        ).toEqual({ x: 76, y: 0, width: 724, height: 174 });
    });

    test('takes a pointer on a zoomed card in the pixels the card lays out in', () => {
        // A card of 400 by 300 on a canvas at half its size.
        expect(layoutPoint({ x: 150, y: 100 }, { left: 50, top: 25, width: 200, height: 150 }, { width: 400, height: 300 })).toEqual({ x: 200, y: 150 });
        expect(layoutPoint({ x: 70, y: 40 }, { left: 50, top: 25, width: 400, height: 300 }, { width: 400, height: 300 })).toEqual({ x: 20, y: 15 });
    });
});

describe('a change the machine reports', () => {
    const folder = '/repo/.ruimte/private/designs/pricing';

    test('reaches a design folder in it or under it, and from a parent only while the folder is not there yet', () => {
        expect(changeReaches(folder, folder, true)).toBe(true);
        expect(changeReaches(`${folder}/assets`, folder, true)).toBe(true);
        // A save of the project writes `.ruimte/private/project.json`.
        expect(changeReaches('/repo/.ruimte/private', folder, true)).toBe(false);
        expect(changeReaches('/repo/.ruimte/private', folder, false)).toBe(true);
        expect(changeReaches('/repo/src', folder, false)).toBe(false);
    });
});

describe('the order of the cards of a design node', () => {
    test('follows the pages while none is open, and holds with a new page on top while one is', () => {
        expect(arrangePages(['b', 'a'], ['a', 'c', 'b'], false)).toEqual(['a', 'c', 'b']);
        expect(arrangePages(null, ['a', 'b'], true)).toEqual(['a', 'b']);
        expect(arrangePages(['b', 'a', 'gone'], ['a', 'c', 'b'], true)).toEqual(['c', 'b', 'a']);
    });
});

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
