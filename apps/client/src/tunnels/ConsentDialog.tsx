import { Button, Dialog, FormError, messageOf, ScrollArea } from '@adecore/ui';
import type { ConsentRequest } from '@ruimte/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConsent } from '@/state/consent';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { transportFor } from '@/transport';
import { draftOf, expiryAt, grantOf, type GrantDraft } from '@/tunnels/grant-draft';
import { GrantFields } from '@/tunnels/GrantFields';

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
    const { t } = useTranslation('settings');
    const waiting = useConsent((s) => s.requests);
    // The request on screen stays until its popup has faded out, after it left the list; only then does the next one open.
    const [shown, setShown] = useState<ConsentRequest | null>(null);
    const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
    const open = shown !== null && waiting.some((entry) => entry.id === shown.id);

    if (shown === null && waiting[0] !== undefined) {
        setShown(waiting[0]);
    }

    const answer = async (approve: boolean, draft: GrantDraft | null): Promise<void> => {
        if (shown === null) {
            return;
        }

        try {
            await transportFor(LOCAL_ENDPOINT_ID)?.request('consent.answer', {
                id: shown.id,
                approve,
                ...(approve && draft !== null ? { grant: grantOf(draft), expiresAt: expiryAt(draft.expiry, Date.now()) } : {})
            });
            setFailure(null);
        } catch (e) {
            setFailure({ id: shown.id, message: messageOf(e, t('tunnels.consent.failed')) });
        }
    };

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(next) => (next ? undefined : void answer(false, null))}
            onOpenChangeComplete={(next) => (next ? undefined : setShown(null))}
        >
            <Dialog.Popup size="sm" className="flex max-h-[85vh] flex-col">
                {shown !== null && (
                    <ConsentPrompt
                        key={shown.id}
                        request={shown}
                        others={waiting.length - (open ? 1 : 0)}
                        failure={failure?.id === shown.id ? failure.message : null}
                        answer={answer}
                    />
                )}
            </Dialog.Popup>
        </Dialog.Root>
    );
}

/* Inside the popup and keyed, so what a person set for one request never carries over to the next. */
function ConsentPrompt({
    request,
    others,
    failure,
    answer
}: {
    request: ConsentRequest;
    others: number;
    failure: string | null;
    answer: (approve: boolean, draft: GrantDraft) => Promise<void>;
}) {
    const { t } = useTranslation('settings');
    const [draft, setDraft] = useState<GrantDraft | null>(null);
    const shown = draft ?? draftOf(request.defaults);

    return (
        <>
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
                <Button onClick={() => void answer(false, shown)}>{t('tunnels.consent.deny')}</Button>
                <Button variant="primary" onClick={() => void answer(true, shown)}>
                    {t('tunnels.consent.approve')}
                </Button>
            </Dialog.Footer>
        </>
    );
}
