import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, PromptDialog, Select } from '@adecore/ui';
import { useHostDialog, useOverlays } from '@/extensions/host/host-dialog-state';

function ChoiceBody({ choices, value, onChange }: { choices: readonly string[]; value: string; onChange: (value: string) => void }) {
    return <Select value={value} label="" items={choices.map((choice) => ({ value: choice, label: choice }))} onValueChange={onChange} />;
}

/* What an extension opens over the app, in Ruimte's own dialog so Escape, focus and the backdrop work as anywhere. */
export function HostOverlays() {
    const open = useOverlays((state) => state.open);

    return open.map((overlay, index) => (
        <Dialog.Root key={overlay.key} open onOpenChange={() => overlay.close()}>
            <Dialog.Popup {...(overlay.size === undefined ? {} : { size: overlay.size })} nested={index > 0}>
                <Dialog.Title className="sr-only">{overlay.title}</Dialog.Title>
                <overlay.component params={overlay.params} close={overlay.close} />
            </Dialog.Popup>
        </Dialog.Root>
    ));
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
