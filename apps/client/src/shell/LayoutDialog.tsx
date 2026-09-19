import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { focusedCanvas } from '@/state/canvas';
import { useUi } from '@/state/ui';
import { Button } from '@/ui/Button';

/* Names an arrangement of the canvas so it can be brought back later from the dock or the palette. */
export function LayoutDialog() {
    const { t } = useTranslation(['shell', 'common']);
    const open = useUi((s) => s.layoutDialogOpen);
    const setOpen = useUi((s) => s.setLayoutDialogOpen);
    const [name, setName] = useState('');

    const submit = (): void => {
        const trimmed = name.trim();
        if (!trimmed) {
            return;
        }
        focusedCanvas().getState().saveLayout(trimmed);
        setName('');
        setOpen(false);
    };

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup w-[380px] p-5">
                    <Dialog.Title className="text-base font-semibold text-text">{t('layoutDialog.title')}</Dialog.Title>
                    <p className="mt-1 text-sm text-text-muted">{t('layoutDialog.description')}</p>
                    <input
                        autoFocus
                        className="field mt-3"
                        aria-label={t('layoutDialog.nameLabel')}
                        placeholder={t('layoutDialog.namePlaceholder')}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                                submit();
                            }
                        }}
                    />
                    <div className="mt-4 flex items-center justify-end gap-2">
                        <Button onClick={() => setOpen(false)}>{t('common:action.cancel')}</Button>
                        <Button variant="primary" disabled={!name.trim()} onClick={submit}>
                            {t('common:action.save')}
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
