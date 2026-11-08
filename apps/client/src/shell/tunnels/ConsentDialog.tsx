import { Button, Dialog, FormError, messageOf, ScrollArea } from '@adecore/ui';
import type { ConsentRequest } from '@ruimte/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { draftOf, expiryAt, grantOf, type GrantDraft } from '@/shell/settings/tunnels/grant-draft';
import { GrantFields } from '@/shell/settings/tunnels/GrantFields';
import { useConsent } from '@/state/consent';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { transportFor } from '@/transport';

/* The host the client's address names. The name in its document is whatever its author typed; the address is where it came from. */
function hostOf(address: string): string {
    try {
        return new URL(address).host;
    } catch {
        return address;
    }
}

/*
 * A client elsewhere asked to connect and waits for a person on this machine. The window shows the same code the client's
 * page shows, with the defaults filled in (all projects, Work, supervised, no expiry); the person narrows them or approves. The
 * public page has no password and nothing to guess. Anyone can ask, so only one request is shown at a time and the title names
 * the host the client's address belongs to; the name it gives itself comes after that, as something nobody checked.
 */
export function ConsentDialog() {
    const waiting = useConsent((s) => s.requests);
    const request = waiting[0];

    if (request === undefined) {
        return null;
    }

    // Keyed, so what a person set for one request never carries over to the next.
    return <ConsentPrompt key={request.id} request={request} others={waiting.length - 1} />;
}

function ConsentPrompt({ request, others }: { request: ConsentRequest; others: number }) {
    const { t } = useTranslation('settings');
    const [draft, setDraft] = useState<GrantDraft | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
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
            <Dialog.Popup size="sm" className="flex max-h-[85vh] flex-col">
                <Dialog.Title className="break-all">{t('tunnels.consent.title', { host: hostOf(request.clientUrl) })}</Dialog.Title>
                <Dialog.Description className="mt-1 break-words">{t('tunnels.consent.description')}</Dialog.Description>
                <ScrollArea className="-mx-5 min-h-0" viewportClassName="flex flex-col gap-3 px-5 py-3">
                    <p className="flex items-center gap-2 text-sm text-text-muted">
                        {t('tunnels.consent.code')}
                        <code aria-label={t('tunnels.consent.code')} className="rounded-md bg-surface-hover px-2 py-1 text-base tracking-widest text-text">
                            {request.code}
                        </code>
                    </p>
                    <p className="text-sm break-words text-text-muted">{t('tunnels.consent.unverifiedName', { name: request.clientName })}</p>
                    <p className="text-xs break-all text-text-muted">{request.clientUrl}</p>
                    <p className="text-sm text-text">{t('tunnels.consent.terminals')}</p>
                    <GrantFields endpointId={LOCAL_ENDPOINT_ID} draft={shown} onChange={setDraft} />
                    {failure !== null && <FormError>{failure}</FormError>}
                    {others > 0 && <p className="text-xs text-text-muted">{t('tunnels.consent.others', { count: others })}</p>}
                </ScrollArea>
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
