import { formatBytes } from '@adecore/ui/format';
import { designAssetType, DesignPageError, inlineDesignPage, type DesignFiles, type DesignPageFailure, type DesignPageUnknownResult } from '@ruimte/contracts';
import i18next from 'i18next';

export function pageFailureText(failure: DesignPageFailure | DesignPageUnknownResult): string {
    switch (failure.kind) {
        case 'unknown':
            return i18next.t('chat:unknownItem.item');
        case 'missing':
            return i18next.t('shell:design.pageMissing', { name: failure.name });
        case 'too-large':
            return i18next.t('shell:design.pageTooLarge', { name: failure.name, size: formatBytes(failure.size), limit: formatBytes(failure.limit) });
        case 'not-text':
            return i18next.t('shell:design.pageNotText', { name: failure.name });
    }
}

/* `inlineDesignPage`, with a page it cannot build worded for a person. */
export async function inlinedPage(files: DesignFiles, file: string): Promise<string> {
    try {
        return await inlineDesignPage(files, file);
    } catch (error) {
        throw error instanceof DesignPageError ? new Error(pageFailureText(error.failure)) : error;
    }
}

/* A file a page names, as the inliner takes it: typed by its name, so a stylesheet and a script load as one. */
export async function inlinedAsset(path: string, blob: Blob): Promise<{ url: string; size: number }> {
    return { url: await dataUrlOf(new Blob([blob], { type: designAssetType(path, blob.type) })), size: blob.size };
}

function dataUrlOf(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
        reader.readAsDataURL(blob);
    });
}
