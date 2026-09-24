import i18next from 'i18next';
import { ArrowLeft, ArrowRight, Code, Copy, Download, ExternalLink, Globe, Image, Link, RotateCw, Scan, Search, Type } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BrowserContextParams } from '@/desktop/bridge';

const SEARCH_URL = 'https://www.google.com/search?q=';

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
    | { kind: 'select-all' }
    | { kind: 'copy-image' }
    | { kind: 'save-image'; url: string }
    | { kind: 'inspect' };

export interface BrowserMenuItem {
    id: string;
    label: string;
    icon: LucideIcon;
    action: BrowserMenuAction;
    disabled?: boolean;
}

const asLabel = (text: string): string => {
    const line = text.trim().replace(/\s+/g, ' ');
    return line.length > 24 ? `${line.slice(0, 24)}…` : line;
};

// http(s) only, matching the window open handler's rule. A link the page carries itself (file:,
// data:) is nothing to hand to a new node or the system browser.
const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url);

/*
 * The rows behind a right-click in a page, in groups with a separator between them. Pure on
 * purpose, since what the click landed on decides the whole menu, and that is what the test drives.
 */
export const buildBrowserMenu = (input: BrowserMenuInput): BrowserMenuItem[][] => {
    // The shell keeps an editable click and pops a native menu over it, so macOS can hang AutoFill,
    // Look Up and Services off it. A shell old enough to still forward one gets no menu at all.
    if (input.isEditable) {
        return [];
    }

    const groups: BrowserMenuItem[][] = [
        [
            { id: 'back', label: i18next.t('browser:menu.back'), icon: ArrowLeft, disabled: !input.canGoBack, action: { kind: 'back' } },
            { id: 'forward', label: i18next.t('browser:menu.forward'), icon: ArrowRight, disabled: !input.canGoForward, action: { kind: 'forward' } },
            { id: 'reload', label: i18next.t('common:action.reload'), icon: RotateCw, action: { kind: 'reload' } }
        ]
    ];

    if (isWebUrl(input.linkURL)) {
        const url = input.linkURL;
        const link: BrowserMenuItem[] = [
            { id: 'link-node', label: i18next.t('browser:menu.link.openInNode'), icon: Globe, action: { kind: 'open-beside', url } },
            { id: 'link-external', label: i18next.t('browser:menu.link.openExternal'), icon: ExternalLink, action: { kind: 'open-external', url } },
            { id: 'link-address', label: i18next.t('browser:menu.link.copyAddress'), icon: Link, action: { kind: 'copy-text', text: url } }
        ];
        if (input.linkText.trim() !== '') {
            link.push({
                id: 'link-text',
                label: i18next.t('browser:menu.link.copyText'),
                icon: Type,
                action: { kind: 'copy-text', text: input.linkText.trim() }
            });
        }
        groups.push(link);
    }

    if (input.mediaType === 'image' && input.srcURL !== '') {
        const src = input.srcURL;
        groups.push([
            { id: 'image-copy', label: i18next.t('browser:menu.image.copy'), icon: Image, action: { kind: 'copy-image' } },
            { id: 'image-address', label: i18next.t('browser:menu.image.copyAddress'), icon: Link, action: { kind: 'copy-text', text: src } },
            // Nothing here handles `will-download`, so Electron asks where to put the file itself.
            { id: 'image-save', label: i18next.t('browser:menu.image.save'), icon: Download, action: { kind: 'save-image', url: src } }
        ]);
    }

    if (input.selectionText !== '') {
        groups.push([
            { id: 'copy', label: i18next.t('common:action.copy'), icon: Copy, disabled: !input.editFlags.canCopy, action: { kind: 'copy-selection' } },
            {
                id: 'search',
                label: i18next.t('browser:menu.selection.search', { text: asLabel(input.selectionText) }),
                icon: Search,
                action: { kind: 'open-external', url: `${SEARCH_URL}${encodeURIComponent(input.selectionText)}` }
            }
        ]);
    }

    groups.push([{ id: 'inspect', label: i18next.t('browser:menu.inspect'), icon: Code, action: { kind: 'inspect' } }]);
    return groups;
};

/*
 * The rows behind a right-click in an HTML file's preview. A preview has no history and nothing in
 * it may leave for the network, so it only copies, selects and hands a web link to a browser node.
 */
export const buildPreviewMenu = (input: BrowserContextParams): BrowserMenuItem[][] => {
    if (input.isEditable) {
        return [];
    }

    const groups: BrowserMenuItem[][] = [];

    if (input.linkURL !== '') {
        const url = input.linkURL;
        const link: BrowserMenuItem[] = [];
        if (isWebUrl(url)) {
            link.push({ id: 'link-node', label: i18next.t('browser:menu.link.openInNode'), icon: Globe, action: { kind: 'open-beside', url } });
        }
        link.push({ id: 'link-address', label: i18next.t('browser:menu.link.copyAddress'), icon: Link, action: { kind: 'copy-text', text: url } });
        groups.push(link);
    }

    if (input.mediaType === 'image' && input.srcURL !== '') {
        groups.push([{ id: 'image-copy', label: i18next.t('browser:menu.image.copy'), icon: Image, action: { kind: 'copy-image' } }]);
    }

    groups.push([
        { id: 'copy', label: i18next.t('common:action.copy'), icon: Copy, disabled: !input.editFlags.canCopy, action: { kind: 'copy-selection' } },
        { id: 'select-all', label: i18next.t('common:action.selectAll'), icon: Scan, action: { kind: 'select-all' } }
    ]);
    return groups;
};
