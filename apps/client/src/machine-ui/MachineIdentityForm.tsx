import { Button, useAsyncAction, IconPicker, FormError, Input } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { type ProjectIconChoice } from '@ruimte/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { perform } from '@/action-port/perform';
import { WithReason } from '@/machine-ui/MachineSettings';
import { SettingsSection } from '@/machines/SettingsSection';
import { useProjectIconGroups } from '@/project/use-project-icon-groups';
import { useServers } from '@/state/server';
import { PROJECT_ICON_KEYWORDS } from '@/surface/project-icons';
import { transportFor } from '@/transport/index';

interface MachineIdentityFormProps {
    endpointId: string;
    /* The name the row shows now, as the placeholder of a machine nobody named. */
    label: string;
    /* Why nothing can be saved, shown on the disabled button; null while the machine answers. */
    disabledReason: string | null;
    /* The icon the account last heard, shown until the machine answers with its own. */
    knownIcon: ProjectIconChoice | null;
}

/*
 * Name and icon travel together on every call, since a null is a choice of its own (the default name, or
 * no icon), so this is one form with one Save. It is keyed on what the machine says, so a change from
 * elsewhere starts it over.
 */
export function MachineIdentityForm({ endpointId, label, disabledReason, knownIcon }: MachineIdentityFormProps) {
    const { t } = useTranslation('settings');
    const info = useServers((s) => s.byEndpoint[endpointId]);
    const savedName = info?.nameSource === 'chosen' ? (info.label ?? '') : '';
    // Before the machine answers its own icon is unknown, not none.
    const savedIcon = disabledReason === null ? (info?.icon ?? null) : knownIcon;
    const [name, setName] = useState(savedName);
    const [icon, setIcon] = useState<ProjectIconChoice | null>(savedIcon);
    const { busy, failure, run, fail } = useAsyncAction(t('identity.saveFailed'));
    const iconGroups = useProjectIconGroups();
    const disabled = disabledReason !== null;
    const dirty = name.trim() !== savedName || JSON.stringify(icon) !== JSON.stringify(savedIcon);

    const save = async (): Promise<void> => {
        if (!transportFor(endpointId)) {
            fail(t('identity.gone'));
            return;
        }
        await run(async () => {
            await perform('machine.setIdentity', { endpointId, name: name.trim() === '' ? null : name.trim(), icon });
        });
    };

    return (
        <SettingsSection title={t('machineDialog.identity.title')} description={t('machineDialog.identity.description')}>
            <SettingsRow
                searchId="machines.machine.identity"
                label={t('identity.name')}
                description={t('identity.nameHint')}
                control={
                    <Input
                        className="w-55"
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
            <SettingsRow
                label={t('identity.icon')}
                description={t('identity.iconHint')}
                control={
                    <IconPicker
                        icons={iconGroups}
                        keywords={PROJECT_ICON_KEYWORDS}
                        rows={7}
                        value={icon?.value ?? null}
                        disabled={disabled}
                        label={t('identity.icon')}
                        hideLabel
                        onValueChange={(name) => setIcon({ kind: 'lucide', value: name as ProjectIconChoice['value'] })}
                        onClear={() => setIcon(null)}
                    />
                }
            />
            <div className="flex min-w-0 flex-col px-4.5 pb-3.5">
                {failure && <FormError className="mt-3 break-words">{failure}</FormError>}
                <div className="mt-3 flex justify-end">
                    <WithReason reason={disabledReason}>
                        <Button variant="primary" disabled={disabled || busy || !dirty} onClick={() => void save()}>
                            {t('common:action.save')}
                        </Button>
                    </WithReason>
                </div>
            </div>
        </SettingsSection>
    );
}
