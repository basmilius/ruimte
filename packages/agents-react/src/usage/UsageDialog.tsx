import type { ReactNode } from 'react';
import i18next from 'i18next';
import { Dialog } from '@basmilius/desktop-ui';

/*
 * The frame of the usage page: larger than the settings, since the chart and the breakdown need the
 * width. What goes in it (`UsagePage`, in an `ErrorBoundary` of the app's) mounts only while it is
 * open, so nothing is scanned behind a closed dialog. It is a dialog and not a view, since none of it
 * belongs to one project.
 */
export function UsageDialog({ open, onOpenChange, children }: { open: boolean; onOpenChange(open: boolean): void; children: ReactNode }) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Popup className="flex h-[820px] w-[1080px] flex-col">
                {children}
                <Dialog.Description className="sr-only">{i18next.t('agent-usage:dialog.description')}</Dialog.Description>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
