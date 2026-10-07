import { useTranslation } from 'react-i18next';
import { isDatabaseTab, useFiles } from '@/state/files';
import { PromptDialog } from '@adecore/ui';

/* A table with edits nobody submitted asks before its tab closes, since closing throws the edits away. */
export function DiscardEditsDialog() {
    const { t } = useTranslation('databases');
    const tab = useFiles((s) => s.tabs.find((entry) => entry.key === s.discarding));
    const table = tab !== undefined && isDatabaseTab(tab) ? (tab.table ?? '') : '';

    return (
        <PromptDialog
            open={tab !== undefined}
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
