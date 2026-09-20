import { describe, expect, test } from 'bun:test';
import { parseMarkdownDocument, markdownImagePath } from './markdown-document';

describe('markdown frontmatter', () => {
    test('shows YAML values without losing types or multiline text', () => {
        const parsed = parseMarkdownDocument(
            '---\ntitle: Hello\npublished: false\ncount: 0\ntags: [one, two]\nauthor:\n  name: Bas\nsummary: |\n  First\n  Second\n---\n# Body'
        );
        expect(parsed).toEqual({
            body: '# Body',
            invalid: false,
            rows: [
                ['title', 'Hello'],
                ['published', 'false'],
                ['count', '0'],
                ['tags', '[\n  "one",\n  "two"\n]'],
                ['author', '{\n  "name": "Bas"\n}'],
                ['summary', 'First\nSecond\n']
            ]
        });
    });
    test('accepts BOM, CRLF and YAML document endings', () => {
        expect(parseMarkdownDocument('\uFEFF---\r\ntitle: Hello\r\n...\r\nBody').rows).toEqual([['title', 'Hello']]);
        expect(parseMarkdownDocument('---\n---').rows).toEqual([]);
    });
    test('leaves ordinary markdown and unclosed frontmatter intact', () => {
        for (const text of ['# Title\n---\nx: y\n---', '---\ntitle: Hello', '```yaml\n---\nx: y\n---\n```']) {
            expect(parseMarkdownDocument(text)).toEqual({ body: text, rows: null, invalid: false });
        }
    });
    test('retains malformed YAML, non-mappings, tags and aliases', () => {
        for (const yaml of ['title: [', 'a: 1\na: 2', '- item', 'plain text', 'a: &a [*a]', 'a: !custom value']) {
            const text = `---\n${yaml}\n---\nBody`;
            expect(parseMarkdownDocument(text)).toEqual({ body: text, rows: null, invalid: true });
        }
    });
});

test('resolves local images from the document folder without treating URLs as paths', () => {
    expect(markdownImagePath('../assets/my%20logo.svg?raw=true#logo', '/repo/docs')).toBe('/repo/docs/../assets/my logo.svg');
    expect(markdownImagePath('/repo/logo.png', '/repo/docs')).toBe('/repo/logo.png');
    for (const src of ['https://example.com/logo.svg', '//example.com/logo.svg', 'data:image/png;base64,a', 'javascript:alert(1)', '#logo', '%zz']) {
        expect(markdownImagePath(src, '/repo')).toBeNull();
    }
});
