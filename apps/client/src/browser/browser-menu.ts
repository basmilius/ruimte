import { ArrowLeft, ArrowRight, Code, Copy, Download, ExternalLink, Globe, Image, Link, RotateCw, Search, Type } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BrowserContextParams } from '@/desktop/bridge';

/* Where a selection goes when someone asks the system browser to look it up. */
const SEARCH_URL = 'https://www.google.com/search?q=';

/* The shell's params plus the two things only the client knows: where the page's history can go. */
export interface BrowserMenuInput extends BrowserContextParams {
    canGoBack: boolean;
    canGoForward: boolean;
}

/*
 * What a row does. The client runs what it owns itself (the page's own history through the
 * registry, a new node beside this one, a string it already has); everything that reaches into
 * the guest, the download stack or the system goes back to the shell.
 */
export type BrowserMenuAction =
    | { kind: 'back' }
    | { kind: 'forward' }
    | { kind: 'reload' }
    | { kind: 'open-beside'; url: string }
    | { kind: 'copy-text'; text: string }
    | { kind: 'open-external'; url: string }
    | { kind: 'copy-selection' }
    | { kind: 'copy-image' }
    | { kind: 'save-image'; url: string }
    | { kind: 'inspect' };

export interface BrowserMenuItem {
    /* Unique in the menu, so a row has a key and a test can name one. */
    id: string;
    label: string;
    icon: LucideIcon;
    action: BrowserMenuAction;
    disabled?: boolean;
}

/* A selection reads in a menu label on one line, short enough to take in at a glance. */
const asLabel = (text: string): string => {
    const line = text.trim().replace(/\s+/g, ' ');
    return line.length > 24 ? `${line.slice(0, 24)}...` : line;
};

// http(s) only, for the same reason the window open handler refuses the rest: a link the page
// carries itself (file:, data:) is nothing to hand to a new node or to the system browser.
const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url);

/*
 * The rows behind a right-click in a page, in groups a separator sits between. Pure on purpose:
 * what the click landed on decides the whole menu, and that is what the test drives.
 */
export const buildBrowserMenu = (input: BrowserMenuInput): BrowserMenuItem[][] => {
    // The shell keeps an editable click and pops a native menu over it, so macOS can hang AutoFill,
    // Look Up and Services off it. A shell old enough to still forward one gets no menu at all.
    if (input.isEditable) {
        return [];
    }

    const groups: BrowserMenuItem[][] = [
        [
            { id: 'back', label: 'Back', icon: ArrowLeft, disabled: !input.canGoBack, action: { kind: 'back' } },
            { id: 'forward', label: 'Forward', icon: ArrowRight, disabled: !input.canGoForward, action: { kind: 'forward' } },
            { id: 'reload', label: 'Reload', icon: RotateCw, action: { kind: 'reload' } }
        ]
    ];

    if (isWebUrl(input.linkURL)) {
        const url = input.linkURL;
        const link: BrowserMenuItem[] = [
            { id: 'link-node', label: 'Open link in new browser node', icon: Globe, action: { kind: 'open-beside', url } },
            { id: 'link-external', label: 'Open link in system browser', icon: ExternalLink, action: { kind: 'open-external', url } },
            { id: 'link-address', label: 'Copy link address', icon: Link, action: { kind: 'copy-text', text: url } }
        ];
        if (input.linkText.trim() !== '') {
            link.push({ id: 'link-text', label: 'Copy link text', icon: Type, action: { kind: 'copy-text', text: input.linkText.trim() } });
        }
        groups.push(link);
    }

    if (input.mediaType === 'image' && input.srcURL !== '') {
        const src = input.srcURL;
        groups.push([
            { id: 'image-copy', label: 'Copy image', icon: Image, action: { kind: 'copy-image' } },
            { id: 'image-address', label: 'Copy image address', icon: Link, action: { kind: 'copy-text', text: src } },
            // Nothing here handles `will-download`, so Electron asks where to put the file itself.
            { id: 'image-save', label: 'Save image as...', icon: Download, action: { kind: 'save-image', url: src } }
        ]);
    }

    if (input.selectionText !== '') {
        groups.push([
            { id: 'copy', label: 'Copy', icon: Copy, disabled: !input.editFlags.canCopy, action: { kind: 'copy-selection' } },
            {
                id: 'search',
                label: `Search the web for "${asLabel(input.selectionText)}"`,
                icon: Search,
                action: { kind: 'open-external', url: `${SEARCH_URL}${encodeURIComponent(input.selectionText)}` }
            }
        ]);
    }

    groups.push([{ id: 'inspect', label: 'Inspect element', icon: Code, action: { kind: 'inspect' } }]);
    return groups;
};
