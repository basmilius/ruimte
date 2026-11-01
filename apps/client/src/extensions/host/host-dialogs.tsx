import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PromptDialog, Select } from '@adecore/ui';
import { useHostDialog } from '@/extensions/host/host-dialog-state';

function ChoiceBody({ choices, value, onChange }: { choices: readonly string[]; value: string; onChange: (value: string) => void }) {
    return <Select value={value} label="" items={choices.map((choice) => ({ value: choice, label: choice }))} onValueChange={onChange} />;
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
