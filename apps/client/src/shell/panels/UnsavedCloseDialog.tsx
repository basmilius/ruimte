import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DraftBar } from '@/shell/panels/DraftBar';
import { closeWithoutSaving, dismissClose as close, retryClose, useUnsavedClose } from '@/shell/panels/unsaved-close';
import { useFiles } from '@/state/files';
import { currentEndpointId } from '@/state/keys';
import { useSettings } from '@/state/settings';
import { Button, Dialog, ScrollArea } from '@adecore/ui';

export function UnsavedCloseDialog() {
    const { t } = useTranslation('panels');
    const pending = useUnsavedClose((s) => s.pending);
    const [busy, setBusy] = useState(false);

    return (
        <Dialog.Root
            open={pending !== null}
            onOpenChange={(open) => {
                if (!open && !busy) {
                    close();
                }
            }}
        >
            <Dialog.Popup size="sm">
                <Dialog.Title>{t('file.unsaved.failedTitle')}</Dialog.Title>
                <Dialog.Text className="mt-1">{t('file.unsaved.description', { count: pending?.paths.length ?? 1 })}</Dialog.Text>
                <ScrollArea className="my-4 max-h-80" viewportClassName="flex flex-col gap-3">
                    {pending?.paths.map((path) => (
                        <div key={path} className="overflow-hidden rounded-md border border-border">
                            <p className="px-3 py-2 text-xs break-all text-text">{path}</p>
                            <DraftBar endpointId={pending.endpointId} path={path} onReviewed={close} />
                        </div>
                    ))}
                </ScrollArea>
                <div className="flex flex-wrap justify-end gap-2">
                    <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                            if (pending !== null) {
                                const path = pending.paths[0];
                                if (path !== undefined && pending.endpointId === currentEndpointId()) {
                                    useFiles.getState().open(path, useSettings.getState().filesTabLimit);
                                }
                            }
                            close();
                        }}
                    >
                        {t('file.unsaved.keepEditing')}
                    </Button>
                    <Button
                        size="sm"
                        variant="danger-outline"
                        disabled={busy}
                        onClick={() => {
                            if (pending !== null) {
                                closeWithoutSaving(pending);
                            }
                            close();
                        }}
                    >
                        {t('file.unsaved.confirm')}
                    </Button>
                    <Button
                        size="sm"
                        variant="primary"
                        disabled={busy}
                        onClick={() => {
                            if (pending !== null) {
                                setBusy(true);
                                void retryClose(pending).finally(() => setBusy(false));
                            }
                        }}
                    >
                        {t('common:action.retry')}
                    </Button>
                </div>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
