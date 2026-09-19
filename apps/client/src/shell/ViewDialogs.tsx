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
import { PromptDialog } from '@/ui/PromptDialog';

/* Renaming, deleting, promoting, picking a mark and a new page: everything a view asks before it happens. */
export function ViewDialogs() {
    const { t } = useTranslation(['shell', 'common']);
    const dialog = useUi((s) => s.viewDialog);
    const setDialog = useUi((s) => s.setViewDialog);
    const viewId = dialog && 'viewId' in dialog ? dialog.viewId : null;
    const view = useDocument((s) => s.views.find((each) => each.id === viewId) ?? null);
    const nodeTitle = useCanvas((s) => (dialog?.kind === 'promote' ? (s.nodes[dialog.nodeId]?.title ?? null) : null));

    const close = (): void => setDialog(null);
    /* A dialog asked about a view that is gone in the meantime has nothing left to ask. */
    const present = dialog !== null && (viewId === null || view !== null);

    return (
        <>
            <PromptDialog
                open={present && dialog.kind === 'rename'}
                title={t('viewDialogs.rename.title')}
                description={t('viewDialogs.rename.description')}
                field={{ ariaLabel: t('viewDialogs.rename.label'), placeholder: t('viewDialogs.rename.placeholder'), initial: view?.name ?? '' }}
                confirmLabel={t('common:action.rename')}
                // An empty field is not a name: the view goes back to the one its own source gives it.
                allowEmpty
                onConfirm={(name) => {
                    if (view) {
                        if (name === '') {
                            resetTitle(view.id);
                        } else {
                            renameViewAction(view.id, name);
                        }
                    }
                    close();
                }}
                onClose={close}
            />

            <PromptDialog
                open={present && dialog.kind === 'new-browser'}
                title={t('viewDialogs.newBrowser.title')}
                description={t('viewDialogs.newBrowser.description')}
                field={{ ariaLabel: t('viewDialogs.newBrowser.label'), placeholder: 'localhost:5173' }}
                confirmLabel={t('common:action.open')}
                onConfirm={(url) => {
                    useDocument.getState().addStandaloneView({ kind: 'browser', name: url, url });
                    close();
                }}
                onClose={close}
            />

            <PromptDialog
                open={present && dialog.kind === 'delete'}
                title={t('viewDialogs.delete.title', { name: view?.name ?? '' })}
                description={view && viewIsBusy(view) ? t('viewDialogs.delete.busy') : t('viewDialogs.delete.description')}
                confirmLabel={t('common:action.delete')}
                confirmIcon={Trash}
                danger
                onConfirm={() => {
                    if (view) {
                        useDocument.getState().deleteView(view.id);
                    }
                    close();
                }}
                onClose={close}
            />

            <PromptDialog
                open={present && dialog.kind === 'promote' && nodeTitle !== null}
                title={t('viewDialogs.promote.title', { name: nodeTitle ?? '' })}
                description={t('viewDialogs.promote.description')}
                confirmLabel={t('viewDialogs.promote.confirm')}
                onConfirm={() => {
                    if (dialog?.kind === 'promote') {
                        useDocument.getState().openAsView(dialog.nodeId);
                    }
                    close();
                }}
                onClose={close}
            />

            {/* Not a question: the icon dialog writes on every click and carries its own way out. */}
            <Dialog.Root open={present && dialog.kind === 'icon'} onOpenChange={(next) => !next && close()}>
                <Dialog.Portal>
                    <Dialog.Backdrop className="dialog-backdrop" />
                    <Dialog.Popup className="dialog-popup w-[420px] p-5">{view && <ViewIconDialog view={view} onClose={close} />}</Dialog.Popup>
                </Dialog.Portal>
            </Dialog.Root>
        </>
    );
}
