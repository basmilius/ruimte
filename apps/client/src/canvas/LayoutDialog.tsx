import { PromptDialog } from '@adecore/ui';
import { MAX_TITLE_LENGTH } from '@ruimte/actions';
import { useTranslation } from 'react-i18next';
import { saveLayoutAction } from '@/action-port/person-actions';
import { layoutDialog } from '@/canvas/dialogs';

/* Names an arrangement of the canvas so it can be brought back later from the dock or the palette. */
export function LayoutDialog() {
    const { t } = useTranslation(['shell', 'common']);
    const open = layoutDialog.useOpen();
    return (
        <PromptDialog
            open={open}
            title={t('layoutDialog.title')}
            description={t('layoutDialog.description')}
            field={{ ariaLabel: t('layoutDialog.nameLabel'), placeholder: t('layoutDialog.namePlaceholder'), maxLength: MAX_TITLE_LENGTH }}
            confirmLabel={t('common:action.save')}
            onConfirm={(name) => {
                saveLayoutAction(name);
                layoutDialog.set(false);
            }}
            onOpenChange={() => layoutDialog.set(false)}
        />
    );
}
