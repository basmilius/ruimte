import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { usePetSettings, type PetSettings } from '@extensions/pets/client/pet-settings';

type BooleanSetting = { [Key in keyof PetSettings]: PetSettings[Key] extends boolean ? Key : never }[keyof PetSettings];

/* A switch for one setting of the pets, with its words under `pets:<id>.label` and `.description`; the search finds it by `id`. */
export function PetSwitchRow({
    id,
    setting,
    leading,
    onChanged
}: {
    id: string;
    setting: BooleanSetting;
    leading?: ReactNode;
    onChanged?: (next: boolean) => void;
}) {
    const { t } = useTranslation('pets');
    const checked = usePetSettings((s) => s[setting]);
    const update = usePetSettings((s) => s.update);

    return (
        <SettingsRow
            searchId={id}
            leading={leading}
            label={t(`${id}.label`)}
            description={t(`${id}.description`)}
            control={
                <Switch
                    checked={checked}
                    onCheckedChange={(next) => {
                        update({ [setting]: next });
                        onChanged?.(next);
                    }}
                    label={t(`${id}.label`)}
                />
            }
        />
    );
}
