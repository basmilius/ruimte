import { describe, expect, test } from 'bun:test';
import { htmlPreviewDocument } from './html-preview';

describe('htmlPreviewDocument', () => {
    test('puts the preview policy first in an existing head', () => {
        const document = htmlPreviewDocument('<html><head><link rel="stylesheet" href="local.css"></head><body>Hello</body></html>');
        expect(document.indexOf('Content-Security-Policy')).toBeLessThan(document.indexOf('<link'));
        expect(document).toContain("default-src 'none'");
        expect(document).toContain("script-src 'none'");
    });

    test('adds a head to a full document that has none', () => {
        const document = htmlPreviewDocument('<!doctype html><html lang="en"><body>Hello</body></html>');
        expect(document).toContain('<html lang="en"><head><meta http-equiv="Content-Security-Policy"');
    });

    test('wraps an HTML fragment as a document', () => {
        expect(htmlPreviewDocument('<main>Hello</main>')).toMatch(/^<!doctype html><html><head>.*<body><main>Hello<\/main><\/body><\/html>$/);
    });
});
