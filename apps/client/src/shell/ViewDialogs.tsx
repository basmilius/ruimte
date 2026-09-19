import { useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { Trash } from 'lucide-react';
import { renameViewAction } from '@/actions/client-actions';
import { viewIsBusy } from '@/project/views';
import { ViewIconDialog } from '@/shell/ViewIconDialog';
import { useCanvas } from '@/state/canvas';
import { resetTitle } from '@/nodes/node-host';
import { useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

/* Renaming, deleting, promoting, picking a mark and a new page: everything a view asks before it happens. */
export function ViewDialogs() {
    const { t } = useTranslation(['shell', 'common']);
    const dialog = useUi((s) => s.viewDialog);
    const setDialog = useUi((s) => s.setViewDialog);
    const viewId = dialog && 'viewId' in dialog ? dialog.viewId : null;
    const view = useDocument((s) => s.views.find((each) => each.id === viewId) ?? null);
    const nodeTitle = useCanvas((s) => (dialog?.kind === 'promote' ? (s.nodes[dialog.nodeId]?.title ?? null) : null));
    const [value, setValue] = useState('');
    const [seen, setSeen] = useState<ViewDialogSeen>(null);

    // The field starts from what the dialog opened on, not from a render somewhere after that.
    const opening = dialog?.kind === 'rename' ? dialog.viewId : dialog?.kind === 'new-browser' ? 'new-browser' : null;
    if (opening !== null && seen !== opening) {
        setSeen(opening);
        setValue(dialog?.kind === 'rename' ? (view?.name ?? '') : '');
    }

    const close = (): void => setDialog(null);

    const submit = (): void => {
        const trimmed = value.trim();
        if (dialog?.kind === 'rename' && view) {
            // An empty field is not a name: the view goes back to the one its own source gives it.
            if (trimmed) {
                renameViewAction(view.id, trimmed);
            } else {
                resetTitle(view.id);
            }
        }
        if (dialog?.kind === 'new-browser' && trimmed) {
            useDocument.getState().addStandaloneView({ kind: 'browser', name: trimmed, url: trimmed });
        }
        close();
    };

    const open = dialog !== null && (viewId === null || view !== null) && (dialog.kind !== 'promote' || nodeTitle !== null);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup w-[420px] p-5">
                    {dialog?.kind === 'rename' && (
                        <>
                            <Dialog.Title className="text-base font-semibold text-text">{t('viewDialogs.rename.title')}</Dialog.Title>
                            <p className="mt-1 text-sm text-text-muted">{t('viewDialogs.rename.description')}</p>
                        </>
                    )}
                    {dialog?.kind === 'new-browser' && (
                        <>
                            <Dialog.Title className="text-base font-semibold text-text">{t('viewDialogs.newBrowser.title')}</Dialog.Title>
                            <p className="mt-1 text-sm text-text-muted">{t('viewDialogs.newBrowser.description')}</p>
                        </>
                    )}
                    {(dialog?.kind === 'rename' || dialog?.kind === 'new-browser') && (
                        <input
                            autoFocus
                            className="field mt-3"
                            aria-label={dialog.kind === 'rename' ? t('viewDialogs.rename.label') : t('viewDialogs.newBrowser.label')}
                            placeholder={dialog.kind === 'rename' ? t('viewDialogs.rename.placeholder') : 'localhost:5173'}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter') {
                                    submit();
                                }
                            }}
                        />
                    )}
                    {dialog?.kind === 'delete' && (
                        <>
                            <Dialog.Title className="text-base font-semibold text-text">
                                {t('viewDialogs.delete.title', { name: view?.name ?? '' })}
                            </Dialog.Title>
                            <p className="mt-1 text-sm text-text-muted">
                                {view && viewIsBusy(view) ? t('viewDialogs.delete.busy') : t('viewDialogs.delete.description')}
                            </p>
                        </>
                    )}
                    {dialog?.kind === 'promote' && (
                        <>
                            <Dialog.Title className="text-base font-semibold text-text">
                                {t('viewDialogs.promote.title', { name: nodeTitle ?? '' })}
                            </Dialog.Title>
                            <p className="mt-1 text-sm text-text-muted">{t('viewDialogs.promote.description')}</p>
                        </>
                    )}
                    {dialog?.kind === 'icon' && view && <ViewIconDialog view={view} onClose={close} />}
                    {/* The icon dialog writes on every click and carries its own way out. */}
                    <div className={clsx('mt-4 flex items-center justify-end gap-2', dialog?.kind === 'icon' && 'hidden')}>
                        <Button onClick={close}>{t('common:action.cancel')}</Button>
                        {dialog?.kind === 'delete' && (
                            <Button
                                variant="danger"
                                onClick={() => {
                                    if (view) {
                                        useDocument.getState().deleteView(view.id);
                                    }
                                    close();
                                }}
                            >
                                <Icon icon={Trash} size={12} /> {t('common:action.delete')}
                            </Button>
                        )}
                        {dialog?.kind === 'promote' && (
                            <Button
                                variant="primary"
                                onClick={() => {
                                    useDocument.getState().openAsView(dialog.nodeId);
                                    close();
                                }}
                            >
                                {t('viewDialogs.promote.confirm')}
                            </Button>
                        )}
                        {(dialog?.kind === 'rename' || dialog?.kind === 'new-browser') && (
                            <Button variant="primary" disabled={!value.trim()} onClick={submit}>
                                {dialog.kind === 'rename' ? t('common:action.rename') : t('common:action.open')}
                            </Button>
                        )}
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/* Which dialog the field was filled for: a view id, or the one dialog that has no view yet. */
type ViewDialogSeen = string | null;
