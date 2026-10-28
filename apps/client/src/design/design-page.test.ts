import { describe, expect, test } from 'bun:test';
import type { FsEntry } from '@ruimte/contracts';
import { assetPathOf, assetReferences, designFiles, pageName, strokesBox, withAssets } from './design-page';

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
});
