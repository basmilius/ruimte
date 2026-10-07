import { useTranslation } from 'react-i18next';
import { isDatabaseView } from '@ruimte/contracts';
import { useDocument } from '@/state/document';
import { isDatabaseTab, useFiles } from '@/state/files';
import { PromptDialog } from '@adecore/ui';

/* A table with edits nobody submitted asks before its tab closes, since closing throws the edits away. */
export function DiscardEditsDialog() {
    const { t } = useTranslation('databases');
    const discarding = useFiles((s) => s.discarding);
    const tab = useFiles((s) => s.tabs.find((entry) => entry.key === s.discarding));
    const view = useDocument((s) => s.views.find((entry) => entry.id === discarding));
    const table = tab !== undefined && isDatabaseTab(tab) ? (tab.table ?? '') : view !== undefined && isDatabaseView(view) ? view.table : '';

    return (
        <PromptDialog
            open={tab !== undefined || view !== undefined}
            danger
            title={t('tab.discard.title', { table })}
            description={t('tab.discard.description')}
            confirmLabel={t('tab.discard.confirm')}
            onConfirm={() => useFiles.getState().confirmDiscard()}
            onOpenChange={(open) => {
                if (!open) {
                    useFiles.getState().cancelDiscard();
                }
            }}
        />
    );
}
