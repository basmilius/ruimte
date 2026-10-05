import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Tooltip, Dialog } from '@adecore/ui';

/*
 * Adding a machine from the start screen, which has no Account pane to do it in. A machine joins
 * through the account and nothing else, so the dialog says how to put it there, and approves the code
 * of a machine that ran `ruimte login`.
 */
export function AddMachineDialog({ open, onOpenChange, onLinkWithCode }: { open: boolean; onOpenChange(open: boolean): void; onLinkWithCode(): void }) {
    const { t } = useTranslation('settings');

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Popup size="sm">
                <Dialog.Title>{t('machines.add.title')}</Dialog.Title>
                <Dialog.Description className="mt-1 break-words">{t('machines.add.description')}</Dialog.Description>
                <Dialog.Footer>
                    <Tooltip label={t('machines.add.codeHint')}>
                        <Button className="mr-auto" onClick={onLinkWithCode}>
                            <Icon icon={KeyRound} size={12} /> {t('machines.add.withCode')}
                        </Button>
                    </Tooltip>
                    <Button variant="primary" onClick={() => onOpenChange(false)}>
                        {t('common:action.close')}
                    </Button>
                </Dialog.Footer>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
