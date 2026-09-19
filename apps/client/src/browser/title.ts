import type { NodeTitleSource } from '@ruimte/contracts';
import i18next from 'i18next';
import { deriveNodeTitle } from '@/chat/title';
import { useBrowserRow } from '@/browser/registry';

/* A person's name belongs to the project. A page's name belongs to the browser session of this client. */
export const browserDisplayTitle = (sharedTitle: string, source: NodeTitleSource | undefined, pageTitle: string | undefined, failed = false): string => {
    if (source === 'user') {
        return sharedTitle;
    }
    const fallback = source === 'auto' ? i18next.t('browser:node.fallbackTitle') : sharedTitle;
    return failed ? fallback : (deriveNodeTitle(pageTitle ?? '') ?? fallback);
};

export const useBrowserDisplayTitle = (id: string, sharedTitle: string, source: NodeTitleSource | undefined): string =>
    useBrowserRow(id, (row) => browserDisplayTitle(sharedTitle, source, row?.title, row?.error !== null && row?.error !== undefined));
