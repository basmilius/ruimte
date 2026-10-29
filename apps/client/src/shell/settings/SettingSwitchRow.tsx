import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useSettings, type Settings } from '@/state/settings';

type BooleanSetting = { [Key in keyof Settings]: Settings[Key] extends boolean ? Key : never }[keyof Settings];

/*
 * A switch for one setting of this client, with its words under `settings:<id>.label` and `.description`;
 * the search finds it by `id`. `leading` stands before the words, such as a picture of what it does.
 */
export function SettingSwitchRow({ id, setting, leading }: { id: string; setting: BooleanSetting; leading?: ReactNode }) {
    const { t } = useTranslation('settings');
    const checked = useSettings((s) => s[setting]);
    const update = useSettings((s) => s.update);

    return (
        <SettingsRow
            searchId={id}
            leading={leading}
            label={t(`${id}.label`)}
            description={t(`${id}.description`)}
            control={<Switch checked={checked} onCheckedChange={(next) => update({ [setting]: next })} label={t(`${id}.label`)} />}
        />
    );
}
