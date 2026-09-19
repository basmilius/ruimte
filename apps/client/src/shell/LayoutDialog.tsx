import { useTranslation } from 'react-i18next';
import { focusedCanvas } from '@/state/canvas';
import { useUi } from '@/state/ui';
import { PromptDialog } from '@/ui/PromptDialog';

/* Names an arrangement of the canvas so it can be brought back later from the dock or the palette. */
export function LayoutDialog() {
    const { t } = useTranslation(['shell', 'common']);
    const open = useUi((s) => s.layoutDialogOpen);
    const setOpen = useUi((s) => s.setLayoutDialogOpen);
    return (
        <PromptDialog
            open={open}
            title={t('layoutDialog.title')}
            description={t('layoutDialog.description')}
            field={{ ariaLabel: t('layoutDialog.nameLabel'), placeholder: t('layoutDialog.namePlaceholder') }}
            confirmLabel={t('common:action.save')}
            onConfirm={(name) => {
                focusedCanvas().getState().saveLayout(name);
                setOpen(false);
            }}
            onClose={() => setOpen(false)}
        />
    );
}
