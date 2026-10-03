import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ACCOUNT_DELETE_WORD, accountConfirmationName, confirmsAccountDeletion, type Account } from '@ruimte/pulsar';
import { deleteAccountHere } from '@/pulsar/account-deletion';
import { Button, Dialog, Field, FormError, Icon, Input, useAsyncAction } from '@basmilius/desktop-ui';

const WHAT_GOES = ['account', 'sessions', 'push', 'machines'] as const;

interface DeleteAccountDialogProps {
    account: Account;
    open: boolean;
    onOpenChange(open: boolean): void;
}

/*
 * Deleting the Ruimte account cannot be undone, so the dialog says what goes and asks for the account's
 * name. The address book compares the name again; the button only spares a request it would refuse.
 */
export function DeleteAccountDialog({ account, open, onOpenChange }: DeleteAccountDialogProps) {
    const { t } = useTranslation(['settings', 'common']);
    const [typed, setTyped] = useState('');
    const { busy, failure, run, clear } = useAsyncAction();
    const name = accountConfirmationName(account);
    const confirmed = confirmsAccountDeletion(account, typed);

    // A dialog opened again starts empty, in the render that shows it.
    const [shownFor, setShownFor] = useState(open);
    if (shownFor !== open) {
        setShownFor(open);
        if (open) {
            setTyped('');
            clear();
        }
    }

    const submit = (): void => {
        if (!confirmed || busy) {
            return;
        }
        void run(async () => {
            await deleteAccountHere(typed);
            onOpenChange(false);
        });
    };

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
            <Dialog.Popup size="sm" nested>
                <Dialog.Title>{t('machines.account.delete.title')}</Dialog.Title>
                <Dialog.Description className="mt-1">{t('machines.account.delete.intro')}</Dialog.Description>
                <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm text-text">
                    {WHAT_GOES.map((entry) => (
                        <li key={entry} className="break-words">
                            {t(`machines.account.delete.goes.${entry}`)}
                        </li>
                    ))}
                </ul>
                <Field
                    label={
                        (account.displayName ?? account.login ?? null) === null
                            ? t('machines.account.delete.fieldWord', { word: ACCOUNT_DELETE_WORD })
                            : t('machines.account.delete.field', { name })
                    }
                    className="mt-4"
                >
                    <Input
                        autoFocus
                        placeholder={name}
                        value={typed}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => setTyped(e.target.value)}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                submit();
                            }
                        }}
                    />
                </Field>
                {failure !== null && <FormError className="mt-2 break-words">{failure}</FormError>}
                <Dialog.Footer>
                    <Button disabled={busy} onClick={() => onOpenChange(false)}>
                        {t('common:action.cancel')}
                    </Button>
                    <Button variant="danger" disabled={busy || !confirmed} onClick={submit}>
                        <Icon icon={Trash2} size={12} /> {busy ? t('machines.account.delete.busy') : t('machines.account.delete.confirm')}
                    </Button>
                </Dialog.Footer>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
