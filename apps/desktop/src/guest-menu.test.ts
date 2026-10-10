import { describe, expect, test } from 'bun:test';
import { contextMenuPayload, editableMenuTemplate } from './guest-menu';

function params(overrides: Partial<Electron.ContextMenuParams> = {}): Electron.ContextMenuParams {
    return {
        x: 4,
        y: 8,
        dictionarySuggestions: [],
        selectionText: '',
        editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: false },
        ...overrides
    } as Electron.ContextMenuParams;
}

const actions = { replaceMisspelling: () => undefined, lookUp: () => undefined, openExternal: () => undefined };

describe('editableMenuTemplate', () => {
    test('offers at most five spelling guesses, then the editing roles', () => {
        const template = editableMenuTemplate(params({ dictionarySuggestions: ['a', 'b', 'c', 'd', 'e', 'f'] }), 'linux', actions);
        expect(template.slice(0, 6).map((item) => item.label ?? item.type)).toEqual(['a', 'b', 'c', 'd', 'e', 'separator']);
        expect(template.map((item) => item.role).filter(Boolean)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectAll']);
    });

    test('a selection on macOS can be looked up and searched, and only an inspectable guest is inspected', () => {
        const opened: string[] = [];
        const template = editableMenuTemplate(params({ selectionText: '  two   words ' }), 'darwin', {
            ...actions,
            openExternal: (url) => opened.push(url),
            inspect: () => undefined
        });
        const labels = template.map((item) => item.label).filter(Boolean);
        expect(labels).toEqual(['Look Up "two words"', 'Search with Google', 'Inspect element']);
        template.find((item) => item.label === 'Search with Google')?.click?.({} as never, undefined, {} as never);
        expect(opened).toEqual(['https://www.google.com/search?q=%20%20two%20%20%20words%20']);
        expect(editableMenuTemplate(params({ selectionText: 'x' }), 'linux', actions).some((item) => item.label !== undefined)).toBe(false);
    });

    test('a rich field can paste without its style', () => {
        const template = editableMenuTemplate(params({ editFlags: { ...params().editFlags, canEditRichly: true } }), 'linux', actions);
        expect(template.some((item) => item.role === 'pasteAndMatchStyle')).toBe(true);
    });
});

test('the payload carries where the click landed and the four flags the client draws', () => {
    const payload = contextMenuPayload(7, 'preview', params({ linkURL: 'https://a.test', pageURL: 'file:///x.html' }));
    expect(payload).toMatchObject({ webContentsId: 7, guest: 'preview', x: 4, y: 8, linkURL: 'https://a.test', pageURL: 'file:///x.html' });
    expect(payload.editFlags).toEqual({ canCut: true, canCopy: true, canPaste: true, canSelectAll: true });
});
