import { Button, Checkbox, Dialog, Field, FormError, Input, messageOf, ScrollArea } from '@adecore/ui';
import { DEFAULT_EXTERNAL_CEILING, DEFAULT_EXTERNAL_TIER } from '@ruimte/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { transportFor } from '@/transport';
import { expiryAt, grantOf, type GrantDraft } from '@/tunnels/grant-draft';
import { GrantFields } from '@/tunnels/GrantFields';

const FRESH: GrantDraft = { tier: DEFAULT_EXTERNAL_TIER, ceiling: DEFAULT_EXTERNAL_CEILING, approvals: false, projects: null, expiry: 'never' };

/*
 * A bearer for a client that can only set a header. It is made here and shown once: the machine keeps a hash and cannot show
 * it again. It works on loopback; on the public hostname only if the person says so, which is the weaker form. The body
 * scrolls, so a long project list never pushes the footer out of the window.
 */
export function NewCredentialDialog({
    open,
    endpointId,
    port,
    onOpenChange,
    onCreated
}: {
    open: boolean;
    endpointId: string;
    port: number | null;
    onOpenChange: (open: boolean) => void;
    onCreated: () => void;
}) {
    const { t } = useTranslation('settings');
    const [label, setLabel] = useState('');
    const [draft, setDraft] = useState<GrantDraft>(FRESH);
    const [onHostname, setOnHostname] = useState(false);
    const [secret, setSecret] = useState<string | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const close = (): void => onOpenChange(false);

    // Only once the popup is gone, so the secret does not turn back into the form while it fades out.
    const reset = (next: boolean): void => {
        if (!next) {
            setLabel('');
            setDraft(FRESH);
            setOnHostname(false);
            setSecret(null);
            setFailure(null);
        }
    };

    const create = async (): Promise<void> => {
        setBusy(true);

        try {
            const made = await transportFor(endpointId)?.request('credential.create', {
                label: label.trim(),
                grant: grantOf(draft),
                bearerOnHostname: onHostname,
                expiresAt: expiryAt(draft.expiry, Date.now())
            });

            if (made) {
                setSecret(made.secret);
                onCreated();
            }
        } catch (e) {
            setFailure(messageOf(e, t('tunnels.bearer.failed')));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange} onOpenChangeComplete={reset}>
            <Dialog.Popup size="sm" className="flex max-h-[85vh] flex-col">
                <Dialog.Title>{t('tunnels.bearer.title')}</Dialog.Title>
                {secret === null ? (
                    <>
                        <Dialog.Description className="mt-1 break-words">{t('tunnels.bearer.description')}</Dialog.Description>
                        <ScrollArea className="-mx-5 min-h-0" viewportClassName="flex flex-col gap-3 px-5 py-3">
                            <Field orientation="horizontal" label={t('tunnels.bearer.label')}>
                                <Input autoFocus value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
                            </Field>
                            <GrantFields endpointId={endpointId} draft={draft} onChange={setDraft} />
                            <label className="flex items-start gap-2.5">
                                <Checkbox label={t('tunnels.bearer.onHostname')} checked={onHostname} onCheckedChange={setOnHostname} />
                                <span className="flex flex-col gap-0.5">
                                    <span className="text-text">{t('tunnels.bearer.onHostname')}</span>
                                    <span className="text-xs text-text-muted">{t('tunnels.bearer.onHostnameWarning')}</span>
                                </span>
                            </label>
                            {failure !== null && <FormError>{failure}</FormError>}
                        </ScrollArea>
                        <Dialog.Footer>
                            <Button onClick={close}>{t('common:action.cancel')}</Button>
                            <Button variant="primary" disabled={busy || label.trim() === ''} onClick={() => void create()}>
                                {t('tunnels.bearer.action')}
                            </Button>
                        </Dialog.Footer>
                    </>
                ) : (
                    <>
                        <Dialog.Description className="mt-1 break-words">{t('tunnels.bearer.once')}</Dialog.Description>
                        <div className="flex flex-col gap-2 py-3">
                            <code aria-label={t('tunnels.bearer.secret')} className="rounded-md bg-surface-hover p-2 text-xs break-all select-all">
                                {secret}
                            </code>
                            {port !== null && (
                                <p className="text-xs text-text-muted">{t('tunnels.bearer.where', { address: `http://127.0.0.1:${port}/mcp` })}</p>
                            )}
                        </div>
                        <Dialog.Footer>
                            <Button onClick={() => void navigator.clipboard.writeText(secret)}>{t('common:action.copy')}</Button>
                            <Button variant="primary" onClick={close}>
                                {t('common:action.close')}
                            </Button>
                        </Dialog.Footer>
                    </>
                )}
            </Dialog.Popup>
        </Dialog.Root>
    );
}
