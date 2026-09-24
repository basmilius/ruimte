import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type ProjectIconChoice } from '@ruimte/contracts';
import { useServers } from '@/state/server';
import { transportFor } from '@/transport';
import { adoptMachineName } from '@/transport/server-info';
import { Button } from '@/ui/Button';
import { DIALOG_FOOTER, FIELD_HINT, FORM_ERROR, SECTION_LABEL } from '@/ui/classes';
import { IconPicker } from '@/ui/IconPicker';
import { useAsyncAction } from '@/ui/useAsyncAction';
import { Tooltip } from '@/ui/Tooltip';

interface MachineIdentityFormProps {
    endpointId: string;
    /* The name the row shows now, as the placeholder of a machine nobody named. */
    label: string;
    /* Why nothing can be saved, shown on the disabled button; null while the machine answers. */
    disabledReason: string | null;
}

/*
 * Name and icon travel together on every call, since a null is a choice of its own (back to the name
 * the machine starts with, or no icon at all). That is why this is one form with one Save, not two
 * steps. Sending half would mean deciding the other half, and another client may have changed it
 * meanwhile. The form is keyed on what the machine says, so a change from elsewhere starts it over.
 */
export function MachineIdentityForm({ endpointId, label, disabledReason }: MachineIdentityFormProps) {
    const { t } = useTranslation('settings');
    const info = useServers((s) => s.byEndpoint[endpointId]);
    const savedName = info?.nameSource === 'chosen' ? (info.label ?? '') : '';
    const savedIcon = info?.icon ?? null;
    const [name, setName] = useState(savedName);
    const [icon, setIcon] = useState<ProjectIconChoice | null>(savedIcon);
    const { busy, failure, run, fail } = useAsyncAction(t('identity.saveFailed'));
    const disabled = disabledReason !== null;
    const dirty = name.trim() !== savedName || JSON.stringify(icon) !== JSON.stringify(savedIcon);

    const save = async (): Promise<void> => {
        const link = transportFor(endpointId);
        if (!link) {
            fail(t('identity.gone'));
            return;
        }
        await run(async () => {
            const next = await link.request('endpoint.setIdentity', { name: name.trim() === '' ? null : name.trim(), icon });
            useServers.getState().setIdentity(endpointId, {
                label: next.label,
                nameSource: next.nameSource ?? null,
                icon: next.icon ?? null,
                agentsDeleteAnyView: next.agentsDeleteAnyView === true
            });
            adoptMachineName(endpointId, next.label, next.nameSource ?? null);
        });
    };

    const saveButton = (
        <Button variant="primary" disabled={disabled || busy || !dirty} onClick={() => void save()}>
            {t('common:action.save')}
        </Button>
    );

    return (
        <div className="flex min-w-0 flex-col p-4">
            <div className={`${SECTION_LABEL} mb-1.5`}>{t('identity.name')}</div>
            <input
                className="field"
                aria-label={t('identity.nameLabel')}
                placeholder={label}
                value={name}
                disabled={disabled}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' && dirty) {
                        void save();
                    }
                }}
            />
            <p className={FIELD_HINT}>{t('identity.nameHint')}</p>

            <IconPicker value={icon} disabled={disabled} onChange={setIcon} onClear={() => setIcon(null)} />

            {failure && (
                <p className={`${FORM_ERROR} mt-3 break-words`} role="alert">
                    {failure}
                </p>
            )}

            <div className={DIALOG_FOOTER}>
                {disabled ? (
                    <Tooltip label={disabledReason}>
                        <span className="inline-flex">{saveButton}</span>
                    </Tooltip>
                ) : (
                    saveButton
                )}
            </div>
        </div>
    );
}
