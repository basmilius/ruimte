import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { Check, KeyRound, X } from 'lucide-react';
import { ProjectIconChoiceSchema } from '@ruimte/contracts';
import { keyFingerprint, normalizeUserCode, type DeviceLinkLookupResult } from '@ruimte/pulsar';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { messageOf, usePulsarAccount, withAccessToken } from '@/pulsar/account';
import { accountName } from '@/pulsar/account-name';
import { linkStep, typedCode } from '@/pulsar/link-request';
import { refreshAccountMachines } from '@/pulsar/machines';
import { SignInButtons } from '@/shell/SignInButtons';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

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
    const accountStatus = usePulsarAccount((s) => s.status);
    const account = usePulsarAccount((s) => s.account);
    const accountError = usePulsarAccount((s) => s.error);
    const [code, setCode] = useState(initialCode ?? '');
    const [lookup, setLookup] = useState<DeviceLinkLookupResult | null>(null);
    const [outcome, setOutcome] = useState<'added' | 'denied' | null>(null);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const step = linkStep({ accountStatus, lookedUp: lookup !== null, outcome });

    const reset = (next: string): void => {
        setCode(next);
        setLookup(null);
        setOutcome(null);
        setFailure(null);
    };

    // A dialog opened again starts over, on the code it was opened with.
    useEffect(() => {
        if (open) {
            reset(initialCode ?? '');
        }
    }, [open, initialCode]);

    const run = async (action: () => Promise<void>): Promise<void> => {
        setBusy(true);
        setFailure(null);
        try {
            await action();
        } catch (e) {
            setFailure(messageOf(e));
        } finally {
            setBusy(false);
        }
    };

    // Takes the code rather than reading the state, since the lookup on open runs before the state holds it.
    const find = (typed: string = code): Promise<void> =>
        run(async () => {
            const userCode = normalizeUserCode(typed);
            if (userCode === null) {
                throw new Error('That is not a code. It is eight letters, like BCDF-GHJK, as the terminal printed it.');
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

    const decide = (approve: boolean): Promise<void> =>
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
            <Dialog.Portal>
                <Dialog.Backdrop className={clsx('dialog-backdrop', nested && 'dialog-backdrop-nested')} forceRender />
                <Dialog.Popup className={clsx('dialog-popup w-[460px] max-w-[calc(100vw-32px)] p-5', nested && 'dialog-popup-nested')}>
                    <Dialog.Title className="text-base font-semibold text-text">Link a machine with a code</Dialog.Title>
                    <Dialog.Description className="mt-1 text-xs text-text-muted">
                        For a machine without the app: run `ruimte login` there, and enter the code it prints.
                    </Dialog.Description>

                    {step === 'unavailable' && (
                        <p className="mt-3 text-sm text-text">Approving a machine works in the desktop app and at station.ruimte.app.</p>
                    )}
                    {step === 'signing-in' && <p className="mt-3 text-sm text-text-muted">Signing in...</p>}
                    {step === 'sign-in' && (
                        <div className="mt-3 flex flex-col items-start gap-2">
                            <p className="text-sm text-text">Sign in to the account the machine should join.</p>
                            {accountError !== null && <p className="text-xs break-words text-status-error">{accountError}</p>}
                            <SignInButtons />
                        </div>
                    )}
                    {step === 'enter-code' && (
                        <>
                            <input
                                autoFocus
                                className="field mt-3 min-w-0 font-mono text-code tracking-widest uppercase"
                                aria-label="Code from the terminal"
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
                            {account !== null && (
                                <p className="mt-1.5 text-xs break-words text-text-faint">The machine joins the account of {accountName(account)}.</p>
                            )}
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
                            <p className="text-xs break-words text-text-muted">
                                Check that the terminal printed this key fingerprint. Once added, every client signed in to this account can open this machine,
                                and the machine can see who opens it.
                            </p>
                        </div>
                    )}
                    {step === 'added' && (
                        <p className="mt-3 text-sm break-words text-text">
                            Approved. {machine?.name ?? 'The machine'} joins your account as soon as its terminal finishes, which takes a few seconds.
                        </p>
                    )}
                    {step === 'denied' && <p className="mt-3 text-sm break-words text-text">Denied. The terminal says so and nothing was added.</p>}

                    {failure !== null && (
                        <p className="mt-2 text-xs break-words text-status-error" role="alert">
                            {failure}
                        </p>
                    )}

                    <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                        {step === 'enter-code' && (
                            <>
                                <Button onClick={() => close(false)}>Cancel</Button>
                                <Button variant="primary" disabled={busy || !code} onClick={() => void find()}>
                                    <Icon icon={KeyRound} size={12} /> Continue
                                </Button>
                            </>
                        )}
                        {step === 'confirm' && (
                            <>
                                <Button disabled={busy} onClick={() => void decide(false)}>
                                    <Icon icon={X} size={12} /> Deny
                                </Button>
                                <Button variant="primary" disabled={busy} onClick={() => void decide(true)}>
                                    <Icon icon={Check} size={12} /> Add to my account
                                </Button>
                            </>
                        )}
                        {step !== 'enter-code' && step !== 'confirm' && <Button onClick={() => close(false)}>Close</Button>}
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
