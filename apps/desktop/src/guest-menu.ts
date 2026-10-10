/* Which guest a right-click came from, so the client draws a preview's menu without a page's history. */
export type GuestKind = 'browser' | 'preview';

/* What the client may ask the shell to do on a guest page. Mirrors `apps/client/src/desktop/bridge.ts`. */
export interface BrowserContextAction {
    webContentsId: number;
    action: string;
    payload?: { url?: string; x?: number; y?: number };
}

/* A sealed preview only reads: nothing it is asked to do may download, inspect or leave for the system browser. */
export const PREVIEW_ACTIONS: ReadonlySet<string> = new Set(['copy', 'select-all', 'copy-image']);

/* So the menu cannot run off the screen. */
const SPELLING_SUGGESTIONS = 5;

/* As in the client's own menu. */
const SEARCH_URL = 'https://www.google.com/search?q=';

function menuLabel(text: string): string {
    const line = text.trim().replace(/\s+/g, ' ');
    return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}

export interface EditableMenuActions {
    replaceMisspelling: (word: string) => void;
    lookUp: () => void;
    openExternal: (url: string) => void;
    /* Absent where the guest may not be inspected. */
    inspect?: () => void;
}

/*
 * The menu over an editable field, native on purpose: macOS hangs AutoFill, Writing Tools and Services
 * off an AppKit menu, and none of that survives a menu the renderer paints. Every row with a standard
 * role uses it, since roles are what the platform recognizes.
 */
export function editableMenuTemplate(
    params: Electron.ContextMenuParams,
    platform: NodeJS.Platform,
    actions: EditableMenuActions
): Electron.MenuItemConstructorOptions[] {
    const template: Electron.MenuItemConstructorOptions[] = [];
    for (const word of params.dictionarySuggestions.slice(0, SPELLING_SUGGESTIONS)) {
        template.push({ label: word, click: () => actions.replaceMisspelling(word) });
    }
    if (template.length > 0) {
        template.push({ type: 'separator' });
    }
    const flags = params.editFlags;
    template.push(
        { role: 'undo', enabled: flags.canUndo },
        { role: 'redo', enabled: flags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: flags.canCut },
        { role: 'copy', enabled: flags.canCopy },
        { role: 'paste', enabled: flags.canPaste }
    );
    // Only a rich field has a style to drop.
    if (flags.canEditRichly) {
        template.push({ role: 'pasteAndMatchStyle', enabled: flags.canPaste });
    }
    template.push({ role: 'delete', enabled: flags.canDelete }, { role: 'selectAll', enabled: flags.canSelectAll });
    if (platform === 'darwin' && params.selectionText !== '') {
        // Electron has no dictionary or search roles; macOS adds Share and Services through the frame.
        template.push(
            { type: 'separator' },
            { label: `Look Up "${menuLabel(params.selectionText)}"`, click: () => actions.lookUp() },
            { label: 'Search with Google', click: () => actions.openExternal(`${SEARCH_URL}${encodeURIComponent(params.selectionText)}`) }
        );
    }
    const inspect = actions.inspect;
    if (inspect) {
        template.push({ type: 'separator' }, { label: 'Inspect element', click: () => inspect() });
    }
    return template;
}

/* What the client draws its own menu from: where the click landed and nothing more. */
export function contextMenuPayload(webContentsId: number, guest: GuestKind, params: Electron.ContextMenuParams) {
    return {
        webContentsId,
        guest,
        x: params.x,
        y: params.y,
        linkURL: params.linkURL,
        linkText: params.linkText,
        srcURL: params.srcURL,
        mediaType: params.mediaType,
        isEditable: params.isEditable,
        selectionText: params.selectionText,
        editFlags: {
            canCut: params.editFlags.canCut,
            canCopy: params.editFlags.canCopy,
            canPaste: params.editFlags.canPaste,
            canSelectAll: params.editFlags.canSelectAll
        },
        pageURL: params.pageURL
    };
}
