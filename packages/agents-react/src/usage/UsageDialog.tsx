import type { ReactNode } from 'react';
import clsx from 'clsx';
import i18next from 'i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { useDialogLayer } from '@ruimte/ui/dialog-layer';

/*
 * The frame of the usage page: larger than the settings, since the chart and the breakdown need the
 * width. What goes in it (`UsagePage`, in an `ErrorBoundary` of the app's) mounts only while it is
 * open, so nothing is scanned behind a closed dialog. It is a dialog and not a view, since none of it
 * belongs to one project.
 */
export function UsageDialog({ open, onOpenChange, children }: { open: boolean; onOpenChange(open: boolean): void; children: ReactNode }) {
    const stacked = useDialogLayer(open);
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Backdrop className={clsx('dialog-backdrop', stacked && 'dialog-backdrop-nested')} forceRender={stacked} />
                <Dialog.Popup className={clsx('dialog-popup flex h-[820px] w-[1080px] flex-col', stacked && 'dialog-popup-nested')}>
                    {children}
                    <Dialog.Description className="sr-only">{i18next.t('agent-usage:dialog.description')}</Dialog.Description>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
