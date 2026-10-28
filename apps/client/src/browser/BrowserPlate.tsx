import { useTranslation } from 'react-i18next';
import { Camera } from 'lucide-react';
import { ERROR_ICON } from '@/browser/error-icons';
import { Favicon } from '@/browser/Favicon';
import { classifyLoadError } from '@/browser/load-error';
import { usePageSnapshots } from '@/browser/page-snapshots';
import { prettyUrl } from '@/browser/pretty-url';
import { useBrowserRow } from '@/browser/registry';
import { endpointKey, useEndpointId } from '@/state/keys';
import { Icon } from '@adecore/ui';

/*
 * What a page past the render distance shows in its node while it keeps running out of sight: the last
 * picture of it, marked as one, since a page that updates by itself does not update here. Without a
 * picture, the page's mark, title and address, in the manner of a file's plate. No words to read: at
 * this zoom they would be a few pixels high.
 */
export function BrowserPlate({ id }: { id: string }) {
    const { t } = useTranslation('canvas');
    const key = endpointKey(useEndpointId(), id);
    const imageUrl = usePageSnapshots((s) => s.byKey[key]?.imageUrl ?? null);
    const title = useBrowserRow(id, (row) => row?.title ?? '');
    const url = useBrowserRow(id, (row) => row?.url ?? '');
    const failure = useBrowserRow(id, (row) => row?.error ?? null);
    const error = failure === null || failure.ownerRoute ? null : classifyLoadError(failure.code, failure.description);

    if (imageUrl !== null && failure === null) {
        return (
            <div className="relative h-full w-full overflow-hidden bg-surface-sunken" role="img" aria-label={t('browser.plate.picture')}>
                <img src={imageUrl} alt="" className="h-full w-full object-cover object-top" draggable={false} />
                <div className="absolute right-3 bottom-3 flex items-center justify-center rounded-full border border-border bg-surface-raised p-2 text-text-muted">
                    <Icon icon={Camera} size={24} />
                </div>
            </div>
        );
    }
    return (
        <div
            className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-sunken px-4 text-text-faint"
            role="img"
            aria-label={t('browser.plate.identity')}
        >
            {error === null ? <Favicon id={id} size={32} /> : <Icon icon={ERROR_ICON[error.kind]} size={32} />}
            {title !== '' && <span className="max-w-full truncate text-sm text-text-muted">{title}</span>}
            {url !== '' && <span className="max-w-full truncate text-sm">{prettyUrl(url)}</span>}
        </div>
    );
}
