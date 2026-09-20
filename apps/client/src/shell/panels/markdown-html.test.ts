import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FILE_HTML_PLUGINS } from './markdown-html';

const render = (text: string) => renderToStaticMarkup(createElement(ReactMarkdown, { rehypePlugins: FILE_HTML_PLUGINS, remarkPlugins: [remarkGfm] }, text));

test('renders README logos, alignment, details and inline HTML', () => {
    const html = render(
        '<p align="center"><a href="https://example.com"><img src="./logo.svg" alt="Logo" width="120"></a></p>\n\n<details><summary>More</summary>Details</details>\n\nText <kbd>Enter</kbd><br>next'
    );
    for (const part of ['align="center"', 'src="./logo.svg"', 'width="120"', '<details>', '<summary>More</summary>', '<kbd>Enter</kbd>', '<br/>']) {
        expect(html).toContain(part);
    }
});

test('strips executable HTML, custom styles and unsafe URLs', () => {
    const html = render(
        '<script>alert(1)</script><style>body{display:none}</style><iframe src="https://example.com"></iframe><svg onload="alert(1)"><circle /></svg><p style="position:fixed" class="absolute" onclick="alert(1)">Safe</p><img src="javascript:alert(1)" onerror="alert(1)"><a href="javascript:alert(1)">Link</a>'
    );
    expect(html).toContain('Safe');
    for (const part of ['<script', '<style', '<iframe', '<svg', 'onclick', 'onerror', 'javascript:', 'position:fixed', 'class="absolute"', 'display:none']) {
        expect(html).not.toContain(part);
    }
});

test('preserves GFM tables and code fences containing HTML', () => {
    const html = render('| A | B |\n| - | - |\n| 1 | 2 |\n\n```html\n<img src="logo.svg">\n```');
    expect(html).toContain('<table>');
    expect(html).toContain('class="language-html"');
    expect(html).toContain('&lt;img');
});
