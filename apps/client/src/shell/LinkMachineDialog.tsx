import { useEffect, useState } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { Check, KeyRound, X } from 'lucide-react';
import { ProjectIconChoiceSchema } from '@ruimte/contracts';
import { keyFingerprint, normalizeUserCode, type DeviceLinkLookupResult } from '@ruimte/pulsar';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { usePulsarAccount, withAccessToken } from '@/pulsar/account';
import { accountName } from '@/pulsar/account-name';
import { linkStep, typedCode } from '@/pulsar/link-request';
import { refreshAccountMachines } from '@/pulsar/machines';
import { SignInButtons } from '@/shell/SignInButtons';
import { Button, useAsyncAction, FieldHint, FormError, Icon, Input, Dialog } from '@adecore/ui';

interface LinkMachineDialogProps {
    open: boolean;
    onOpenChange(open: boolean): void;
    // The code the address carried, filled in and looked up once the person is signed in.
    initialCode: string | null;
    // Inside the settings dialog, which draws its own backdrop underneath.
    nested?: boolean;
}

/*
 * Approving a machine that ran `ruimte login`: the code from its terminal, the machine it belongs to
 * with its key fingerprint to compare, and a yes or a no. The yes only tells the address book which
 * account; the machine signs its own registration for it from the terminal a moment later.
 */
export function LinkMachineDialog({ open, onOpenChange, initialCode, nested = false }: LinkMachineDialogProps) {
    const { t } = useTranslation(['shell', 'common']);
    const accountStatus = usePulsarAccount((s) => s.status);
    const account = usePulsarAccount((s) => s.account);
    const accountError = usePulsarAccount((s) => s.error);
    const [code, setCode] = useState(initialCode ?? '');
    const [lookup, setLookup] = useState<DeviceLinkLookupResult | null>(null);
    const [outcome, setOutcome] = useState<'added' | 'denied' | null>(null);
    const { busy, failure, run, clear } = useAsyncAction();
    const step = linkStep({ accountStatus, lookedUp: lookup !== null, outcome });

    const reset = (next: string): void => {
        setCode(next);
        setLookup(null);
        setOutcome(null);
        clear();
    };

    // A dialog opened again starts over, on the code it was opened with, in the render that shows it.
    const [shownFor, setShownFor] = useState({ open, initialCode });
    if (shownFor.open !== open || shownFor.initialCode !== initialCode) {
        setShownFor({ open, initialCode });
        if (open) {
            reset(initialCode ?? '');
        }
    }

    // Takes the code rather than reading the state, since the lookup on open runs before the state holds it.
    const find = (typed: string = code): Promise<boolean> =>
        run(async () => {
            const userCode = normalizeUserCode(typed);
            if (userCode === null) {
                throw new Error(i18next.t('shell:linkMachine.badCode'));
            }
            setLookup(await withAccessToken((client, token) => client.lookupDeviceLink(token, { userCode })));
        });

    // A code from the address is looked up as soon as there is someone signed in to look it up for.
    useEffect(() => {
        if (open && accountStatus === 'signed-in' && initialCode !== null && lookup === null && outcome === null) {
            void find(initialCode);
        }
        // Only on the moments that can make the lookup possible, not on every keystroke.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [open, accountStatus, initialCode]);

    const decide = (approve: boolean): Promise<boolean> =>
        run(async () => {
            const userCode = normalizeUserCode(code) ?? '';
            if (approve) {
                await withAccessToken((client, token) => client.approveDeviceLink(token, { userCode }));
                setOutcome('added');
            } else {
                await withAccessToken((client, token) => client.denyDeviceLink(token, { userCode }));
                setOutcome('denied');
            }
        });

    const close = (next: boolean): void => {
        if (!next && outcome === 'added') {
            void refreshAccountMachines();
        }
        onOpenChange(next);
    };

    const machine = lookup?.machine ?? null;
    const icon = ProjectIconChoiceSchema.safeParse(machine?.icon);

    return (
        <Dialog.Root open={open} onOpenChange={close}>
            <Dialog.Popup size="sm" nested={nested}>
                <Dialog.Title>{t('linkMachine.title')}</Dialog.Title>
                <Dialog.Description className="mt-1">{t('linkMachine.description')}</Dialog.Description>

                {step === 'unavailable' && <p className="mt-3 text-sm text-text">{t('linkMachine.unavailable')}</p>}
                {step === 'signing-in' && <p className="mt-3 text-sm text-text-muted">{t('linkMachine.signingIn')}</p>}
                {step === 'sign-in' && (
                    <div className="mt-3 flex flex-col items-start gap-2">
                        <p className="text-sm text-text">{t('linkMachine.signIn')}</p>
                        {accountError !== null && <FormError className="break-words">{accountError}</FormError>}
                        <SignInButtons />
                    </div>
                )}
                {step === 'enter-code' && (
                    <>
                        <Input
                            autoFocus
                            mono
                            className="mt-3 min-w-0 tracking-widest uppercase"
                            aria-label={t('linkMachine.codeLabel')}
                            placeholder="BCDF-GHJK"
                            value={code}
                            spellCheck={false}
                            autoComplete="off"
                            onChange={(e) => reset(typedCode(e.target.value))}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter' && code) {
                                    void find();
                                }
                            }}
                        />
                        {account !== null && <FieldHint className="break-words">{t('linkMachine.joinsAccount', { account: accountName(account) })}</FieldHint>}
                    </>
                )}
                {step === 'confirm' && machine !== null && (
                    <div className="mt-3 flex flex-col gap-3">
                        <div className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
                            <MachineGlyph icon={icon.success ? icon.data : null} className="text-text-muted" />
                            <span className="flex min-w-0 grow flex-col">
                                <span className="truncate text-sm text-text">{machine.name}</span>
                                <span className="font-mono text-xs text-text-faint">{keyFingerprint(machine.publicKey)}</span>
                            </span>
                        </div>
                        <p className="text-xs break-words text-text-muted">{t('linkMachine.checkFingerprint')}</p>
                    </div>
                )}
                {step === 'added' && (
                    <p className="mt-3 text-sm break-words text-text">{t('linkMachine.approved', { machine: machine?.name ?? t('linkMachine.theMachine') })}</p>
                )}
                {step === 'denied' && <p className="mt-3 text-sm break-words text-text">{t('linkMachine.denied')}</p>}

                {failure !== null && <FormError className="mt-2 break-words">{failure}</FormError>}

                <Dialog.Footer>
                    {step === 'enter-code' && (
                        <>
                            <Button onClick={() => close(false)}>{t('common:action.cancel')}</Button>
                            <Button variant="primary" disabled={busy || !code} onClick={() => void find()}>
                                <Icon icon={KeyRound} size={12} /> {t('linkMachine.continue')}
                            </Button>
                        </>
                    )}
                    {step === 'confirm' && (
                        <>
                            <Button disabled={busy} onClick={() => void decide(false)}>
                                <Icon icon={X} size={12} /> {t('linkMachine.deny')}
                            </Button>
                            <Button variant="primary" disabled={busy} onClick={() => void decide(true)}>
                                <Icon icon={Check} size={12} /> {t('linkMachine.approve')}
                            </Button>
                        </>
                    )}
                    {step !== 'enter-code' && step !== 'confirm' && <Button onClick={() => close(false)}>{t('common:action.close')}</Button>}
                </Dialog.Footer>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
