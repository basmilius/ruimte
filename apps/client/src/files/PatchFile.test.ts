/// <reference types="vite/client" />
import { describe, expect, mock, test } from 'bun:test';
import type { FsReadText } from '@ruimte/contracts';

// Named stand-ins keep this dispatch test independent of the DOM and editor engine.
const stand = (name: string) => ({ [name]: Object.assign(() => null, { displayName: name }) });
mock.module('./CodeFile.tsx', () => stand('CodeFile'));
mock.module('./HtmlFile.tsx', () => stand('HtmlFile'));
mock.module('./ImageFile.tsx', () => stand('ImageFile'));
mock.module('./MarkdownFile.tsx', () => stand('MarkdownFile'));
mock.module('./MediaFile.tsx', () => stand('MediaFile'));
mock.module('./UnsupportedFile.tsx', () => stand('UnsupportedFile'));
mock.module('./PdfPreview.tsx', () => stand('PdfPreview'));
mock.module('./SvgFile.tsx', () => stand('SvgFile'));
mock.module('./patch-file-lazy.tsx', () => stand('PatchFileSlot'));

const { renderFile } = await import('./renderers.tsx');

const READ = { kind: 'text', text: '', size: 0, mtime: 0, encoding: 'utf-8', language: 'diff' } as unknown as FsReadText;

function drawnBy(name: string): string {
    const element = renderFile({ path: `/p/${name}`, name, read: READ });
    return (element.type as { displayName: string }).displayName;
}

describe('which view draws a text file', () => {
    test('a .patch or .diff file mounts the patch mode', () => {
        expect(drawnBy('fix.patch')).toBe('PatchFileSlot');
        expect(drawnBy('FIX.DIFF')).toBe('PatchFileSlot');
    });

    test('other files keep the view they had', () => {
        expect(drawnBy('notes.md')).toBe('MarkdownFile');
        expect(drawnBy('index.html')).toBe('HtmlFile');
        expect(drawnBy('main.ts')).toBe('CodeFile');
        expect(drawnBy('patch')).toBe('CodeFile');
        expect(drawnBy('a.patch.bak')).toBe('CodeFile');
    });
});

describe('which view draws an image', () => {
    const drawnAs = (mime: string): string => {
        const element = renderFile({ path: '/p/logo', name: 'logo', read: { kind: 'binary', mime, size: 1, mtime: 0 } });
        return (element.type as { displayName: string }).displayName;
    };

    test('an SVG gets the view with its source beside the picture, any other image the picture alone', () => {
        expect(drawnAs('image/svg+xml')).toBe('SvgFile');
        expect(drawnAs('image/png')).toBe('ImageFile');
    });
});
