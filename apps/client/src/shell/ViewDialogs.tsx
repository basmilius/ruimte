import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { createViewAction, promoteNodeAction } from '@/actions/client-actions';
import { ViewSettingsDialog } from '@/shell/ViewSettingsDialog';
import { useCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useUi } from '@/state/ui';
import { SMALL_DIALOG } from '@ruimte/ui/classes';
import { PromptDialog } from '@ruimte/ui/PromptDialog';

/* Settings, promoting and a new page: everything a view asks before it happens. */
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
                open={present && dialog.kind === 'new-browser'}
                title={t('viewDialogs.newBrowser.title')}
                description={t('viewDialogs.newBrowser.description')}
                field={{ ariaLabel: t('viewDialogs.newBrowser.label'), placeholder: 'localhost:5173' }}
                confirmLabel={t('common:action.open')}
                onConfirm={(url) => {
                    void createViewAction('browser', { url });
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
                        promoteNodeAction(dialog.nodeId);
                    }
                    close();
                }}
                onClose={close}
            />

            {/* Not a question: the settings dialog writes as it goes and carries its own way out. */}
            <Dialog.Root open={present && dialog.kind === 'settings'} onOpenChange={(next) => !next && close()}>
                <Dialog.Portal>
                    <Dialog.Backdrop className="dialog-backdrop" />
                    <Dialog.Popup className={SMALL_DIALOG}>{view && <ViewSettingsDialog view={view} onClose={close} />}</Dialog.Popup>
                </Dialog.Portal>
            </Dialog.Root>
        </>
    );
}
