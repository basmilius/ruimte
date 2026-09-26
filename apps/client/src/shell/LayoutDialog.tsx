import { useTranslation } from 'react-i18next';
import { MAX_TITLE_LENGTH } from '@ruimte/actions';
import { saveLayoutAction } from '@/actions/client-actions';
import { useUi } from '@/state/ui';
import { PromptDialog } from '@ruimte/ui/PromptDialog';

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
            field={{ ariaLabel: t('layoutDialog.nameLabel'), placeholder: t('layoutDialog.namePlaceholder'), maxLength: MAX_TITLE_LENGTH }}
            confirmLabel={t('common:action.save')}
            onConfirm={(name) => {
                saveLayoutAction(name);
                setOpen(false);
            }}
            onClose={() => setOpen(false)}
        />
    );
}
