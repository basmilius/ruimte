import { describe, expect, test } from 'bun:test';
import { buildBrowserMenu, type BrowserMenuInput, type BrowserMenuItem } from '@/browser/browser-menu';

const input = (patch: Partial<BrowserMenuInput> = {}): BrowserMenuInput => ({
    webContentsId: 7,
    x: 10,
    y: 20,
    linkURL: '',
    linkText: '',
    srcURL: '',
    mediaType: 'none',
    isEditable: false,
    selectionText: '',
    editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: false },
    pageURL: 'https://bas.dev/',
    canGoBack: false,
    canGoForward: false,
    ...patch
});

const ids = (groups: BrowserMenuItem[][]): string[][] => groups.map((group) => group.map((item) => item.id));

const find = (groups: BrowserMenuItem[][], id: string): BrowserMenuItem | undefined => groups.flat().find((item) => item.id === id);

describe('buildBrowserMenu', () => {
    test('a click on nothing is the page itself', () => {
        expect(ids(buildBrowserMenu(input()))).toEqual([['back', 'forward', 'reload'], ['inspect']]);
    });

    test('history rows follow what the page can still do', () => {
        const menu = buildBrowserMenu(input({ canGoBack: true }));
        expect(find(menu, 'back')?.disabled).toBe(false);
        expect(find(menu, 'forward')?.disabled).toBe(true);
    });

    test('a link opens beside, in the system browser, or lands on the clipboard', () => {
        const menu = buildBrowserMenu(input({ linkURL: 'https://bas.dev/over', linkText: '  About  ' }));
        expect(ids(menu)[1]).toEqual(['link-node', 'link-external', 'link-address', 'link-text']);
        expect(find(menu, 'link-node')?.action).toEqual({ kind: 'open-beside', url: 'https://bas.dev/over' });
        expect(find(menu, 'link-text')?.action).toEqual({ kind: 'copy-text', text: 'About' });
    });

    test('a link the page carries itself is no link to hand on', () => {
        expect(ids(buildBrowserMenu(input({ linkURL: 'file:///etc/hosts' })))).toEqual([['back', 'forward', 'reload'], ['inspect']]);
    });

    test('a link without text has no row to copy it from', () => {
        const menu = buildBrowserMenu(input({ linkURL: 'https://bas.dev/', linkText: '   ' }));
        expect(find(menu, 'link-text')).toBeUndefined();
    });

    test('an image copies, names itself and downloads', () => {
        const menu = buildBrowserMenu(input({ mediaType: 'image', srcURL: 'https://bas.dev/a.png' }));
        expect(ids(menu)[1]).toEqual(['image-copy', 'image-address', 'image-save']);
        expect(find(menu, 'image-save')?.action).toEqual({ kind: 'save-image', url: 'https://bas.dev/a.png' });
    });

    test("an editable field is the shell's own native menu, so the client draws nothing", () => {
        const menu = buildBrowserMenu(
            input({
                isEditable: true,
                selectionText: 'teh',
                editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true }
            })
        );
        expect(menu).toEqual([]);
    });

    test('an editable field beats everything else the click landed on', () => {
        expect(buildBrowserMenu(input({ isEditable: true, linkURL: 'https://bas.dev/', mediaType: 'image', srcURL: 'https://bas.dev/a.png' }))).toEqual([]);
    });

    test('a selection copies and searches, and never next to the edit rows', () => {
        const menu = buildBrowserMenu(
            input({
                selectionText: 'the  quick brown fox jumps over the lazy dog',
                editFlags: { canCut: false, canCopy: true, canPaste: false, canSelectAll: true }
            })
        );
        expect(ids(menu)[1]).toEqual(['copy', 'search']);
        expect(find(menu, 'copy')?.disabled).toBe(false);
        expect(find(menu, 'search')?.label).toBe('Search the web for "the quick brown fox jump..."');
        expect(find(menu, 'search')?.action).toEqual({
            kind: 'open-external',
            url: 'https://www.google.com/search?q=the%20%20quick%20brown%20fox%20jumps%20over%20the%20lazy%20dog'
        });
    });

    test('inspect ends every menu', () => {
        const menu = buildBrowserMenu(input({ linkURL: 'https://bas.dev/', mediaType: 'image', srcURL: 'https://bas.dev/a.png' }));
        expect(ids(menu).at(-1)).toEqual(['inspect']);
    });
});
