import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type ProjectIconChoice } from '@ruimte/contracts';
import { SettingsRow } from '@ruimte/ui/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useServers } from '@/state/server';
import { transportFor } from '@/transport';
import { adoptMachineName } from '@/transport/server-info';
import { Button } from '@ruimte/ui/Button';
import { FORM_ERROR } from '@ruimte/ui/classes';
import { IconPicker } from '@/ui/IconPicker';
import { useAsyncAction } from '@ruimte/ui/useAsyncAction';
import { Tooltip } from '@ruimte/ui/Tooltip';

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
        <SettingsSection title={t('machineDialog.identity.title')} description={t('machineDialog.identity.description')}>
            <SettingsRow
                searchId="machines.machine.identity"
                label={t('identity.name')}
                description={t('identity.nameHint')}
                control={
                    <input
                        className="field w-55"
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
                }
            />
            <div className="flex min-w-0 flex-col px-4.5 pb-3.5">
                <IconPicker value={icon} disabled={disabled} onChange={setIcon} onClear={() => setIcon(null)} />
                {failure && (
                    <p className={`${FORM_ERROR} mt-3 break-words`} role="alert">
                        {failure}
                    </p>
                )}
                <div className="mt-3 flex justify-end">
                    {disabled ? (
                        <Tooltip label={disabledReason}>
                            <span className="inline-flex">{saveButton}</span>
                        </Tooltip>
                    ) : (
                        saveButton
                    )}
                </div>
            </div>
        </SettingsSection>
    );
}
