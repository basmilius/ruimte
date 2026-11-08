import { Button, Dialog, FormError, messageOf } from '@adecore/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { draftOf, expiryAt, grantOf, type GrantDraft } from '@/shell/settings/tunnels/grant-draft';
import { GrantFields } from '@/shell/settings/tunnels/GrantFields';
import { useConsent } from '@/state/consent';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { transportFor } from '@/transport';

/*
 * A client elsewhere asked to connect and waits for a person on this machine. The window shows the same code the client's
 * page shows, with the defaults filled in (all projects, Work, supervised, no expiry); the person narrows them or approves. The
 * public page has no password and nothing to guess.
 */
export function ConsentDialog() {
    const { t } = useTranslation('settings');
    const request = useConsent((s) => s.requests[0]);
    const [draft, setDraft] = useState<GrantDraft | null>(null);
    const [failure, setFailure] = useState<string | null>(null);

    if (request === undefined) {
        return null;
    }

    const shown = draft ?? draftOf(request.defaults);
    const answer = async (approve: boolean): Promise<void> => {
        try {
            await transportFor(LOCAL_ENDPOINT_ID)?.request('consent.answer', {
                id: request.id,
                approve,
                ...(approve ? { grant: grantOf(shown), expiresAt: expiryAt(shown.expiry, Date.now()) } : {})
            });
            setDraft(null);
            setFailure(null);
        } catch (e) {
            setFailure(messageOf(e, t('tunnels.consent.failed')));
        }
    };

    return (
        <Dialog.Root open onOpenChange={(next) => (next ? undefined : void answer(false))}>
            <Dialog.Popup size="sm">
                <Dialog.Title>{t('tunnels.consent.title', { client: request.clientName })}</Dialog.Title>
                <Dialog.Description className="mt-1 break-words">{t('tunnels.consent.description')}</Dialog.Description>
                <div className="flex flex-col gap-3 py-3">
                    <p className="flex items-center gap-2 text-sm text-text-muted">
                        {t('tunnels.consent.code')}
                        <code aria-label={t('tunnels.consent.code')} className="rounded-md bg-surface-hover px-2 py-1 text-base tracking-widest text-text">
                            {request.code}
                        </code>
                    </p>
                    <p className="text-xs break-all text-text-muted">{request.clientUrl}</p>
                    <GrantFields endpointId={LOCAL_ENDPOINT_ID} draft={shown} onChange={setDraft} />
                    {failure !== null && <FormError>{failure}</FormError>}
                </div>
                <Dialog.Footer>
                    <Button onClick={() => void answer(false)}>{t('tunnels.consent.deny')}</Button>
                    <Button variant="primary" onClick={() => void answer(true)}>
                        {t('tunnels.consent.approve')}
                    </Button>
                </Dialog.Footer>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
