import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { KeyRound, Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PAIRING_PLACEHOLDER, usePairMachine } from '@/shell/settings/pair-machine';
import { Button } from '@/ui/Button';
import { DIALOG_DESCRIPTION, DIALOG_FOOTER, FIELD_HINT, FORM_ERROR, SMALL_DIALOG } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/*
 * Adding a machine from the start screen, which has no Account pane to do it in. The dialog is about
 * "a machine" rather than "a pairing link", which leaves room for a second way in (a code for a phone).
 */
export function AddMachineDialog({ open, onOpenChange, onLinkWithCode }: { open: boolean; onOpenChange(open: boolean): void; onLinkWithCode(): void }) {
    const { t } = useTranslation('settings');
    const { link, setLink, failure, pair, canPair } = usePairMachine(() => onOpenChange(false));

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" forceRender />
                <Dialog.Popup className={SMALL_DIALOG}>
                    <Dialog.Title className="text-base font-semibold text-text">{t('machines.add.title')}</Dialog.Title>
                    <Dialog.Description className={clsx(DIALOG_DESCRIPTION, 'mt-1')}>{t('machines.add.description')}</Dialog.Description>
                    <input
                        autoFocus
                        className="field mt-3 min-w-0 font-mono text-code"
                        aria-label={t('machines.add.linkLabel')}
                        placeholder={PAIRING_PLACEHOLDER}
                        value={link}
                        spellCheck={false}
                        onChange={(e) => setLink(e.target.value)}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter' && canPair) {
                                void pair();
                            }
                        }}
                    />
                    <p className={clsx(FIELD_HINT, 'break-words')}>{t('machines.add.hint')}</p>
                    {failure && (
                        <p className={clsx(FORM_ERROR, 'mt-2 break-words')} role="alert">
                            {failure}
                        </p>
                    )}
                    <div className={DIALOG_FOOTER}>
                        <Tooltip label={t('machines.add.codeHint')}>
                            <Button className="mr-auto" onClick={onLinkWithCode}>
                                <Icon icon={KeyRound} size={12} /> {t('machines.add.withCode')}
                            </Button>
                        </Tooltip>
                        <Button onClick={() => onOpenChange(false)}>{t('common:action.cancel')}</Button>
                        <Button variant="primary" disabled={!canPair} onClick={() => void pair()}>
                            <Icon icon={Link2} size={12} /> {t('machines.add.pair')}
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
