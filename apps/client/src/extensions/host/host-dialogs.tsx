import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseButton, Dialog, PromptDialog, Select } from '@adecore/ui';
import { removeOverlay, useHostDialog, useOverlays, type OpenOverlay } from '@/extensions/host/host-dialog-state';

function ChoiceBody({ choices, value, onChange }: { choices: readonly string[]; value: string; onChange: (value: string) => void }) {
    return <Select value={value} label="" items={choices.map((choice) => ({ value: choice, label: choice }))} onValueChange={onChange} />;
}

/*
 * One overlay in Ruimte's own format: its header with the title and a way out, and the extension's body under it.
 * It starts closed for a frame, since a dialog that mounts open has nothing to animate from.
 */
function HostOverlay({ overlay, nested }: { overlay: OpenOverlay; nested: boolean }) {
    const { t } = useTranslation('common');
    const [entered, setEntered] = useState(false);

    useEffect(() => {
        const frame = requestAnimationFrame(() => setEntered(true));

        return () => cancelAnimationFrame(frame);
    }, []);

    return (
        <Dialog.Root
            open={entered && !overlay.closing}
            onOpenChange={() => overlay.close()}
            onOpenChangeComplete={(open) => {
                if (!open && overlay.closing) {
                    removeOverlay(overlay.key);
                }
            }}
        >
            <Dialog.Popup {...(overlay.size === undefined ? {} : { size: overlay.size })} nested={nested} className="flex max-h-[80vh] flex-col">
                <header className="mb-3 flex shrink-0 items-center gap-2">
                    <Dialog.Title className="min-w-0 grow truncate">{overlay.title}</Dialog.Title>
                    <CloseButton label={t('action.close')} onClick={() => overlay.close()} />
                </header>
                <div className="min-h-0 grow overflow-y-auto">
                    <overlay.component params={overlay.params} close={overlay.close} />
                </div>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

/* What an extension opens over the app, in Ruimte's own dialog so Escape, focus and the backdrop work as anywhere. */
export function HostOverlays() {
    const open = useOverlays((state) => state.open);

    return open.map((overlay, index) => <HostOverlay key={overlay.key} overlay={overlay} nested={index > 0} />);
}

/* The dialogs of Ruimte for what an extension asks, so it never falls back on the browser's own. */
export function HostDialogs() {
    const { t } = useTranslation('common');
    const request = useHostDialog((state) => state.request);
    const [choice, setChoice] = useState('');

    if (request === null) {
        return null;
    }

    const picked = choice !== '' && request.choices?.includes(choice) === true ? choice : (request.choices?.[0] ?? '');

    return (
        <PromptDialog
            open
            title={request.title}
            {...(request.body === undefined ? {} : { description: request.body })}
            {...(request.field === undefined ? {} : { field: { ariaLabel: request.title, ...request.field } })}
            confirmLabel={t('action.ok')}
            danger={request.danger === true}
            onConfirm={(value) => request.answer(request.choices === undefined ? value : picked)}
            onOpenChange={() => request.answer(null)}
        >
            {request.choices !== undefined && <ChoiceBody choices={request.choices} value={picked} onChange={setChoice} />}
        </PromptDialog>
    );
}
