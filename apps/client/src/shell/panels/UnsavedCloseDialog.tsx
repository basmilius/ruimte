import { useTranslation } from 'react-i18next';
import { Trash } from 'lucide-react';
import { basenameOf } from '@/shell/panels/files-tree';
import { closeWithoutSaving, useUnsavedClose } from '@/shell/panels/unsaved-close';
import { PromptDialog } from '@/ui/PromptDialog';

/* Asked only when closing could not save first, so it is about changes that would be lost. */
export function UnsavedCloseDialog() {
    const { t } = useTranslation('panels');
    const pending = useUnsavedClose((s) => s.pending);
    const close = (): void => useUnsavedClose.setState({ pending: null });
    const first = pending?.paths[0];

    return (
        <PromptDialog
            open={pending !== null}
            title={t('file.unsaved.title', { count: pending?.paths.length ?? 1, name: first === undefined ? '' : basenameOf(first) })}
            description={t('file.unsaved.description', { count: pending?.paths.length ?? 1 })}
            confirmLabel={t('file.unsaved.confirm')}
            confirmIcon={Trash}
            danger
            onConfirm={() => {
                if (pending !== null) {
                    closeWithoutSaving(pending);
                }
                close();
            }}
            onClose={close}
        />
    );
}
