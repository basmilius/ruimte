import { useTranslation } from 'react-i18next';
import type { EditorSmartKeys } from '@ruimte/smart-editor';
import { SettingsRow } from '@basmilius/desktop-ui/settings';
import { Switch } from '@basmilius/desktop-ui';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useSettings } from '@/state/settings';

/* The switch of each key and the words under `appearance.smartKeys.<words>`. */
const KEYS = [
    ['autoPairBrackets', 'pairBrackets'],
    ['autoPairQuotes', 'pairQuotes'],
    ['surroundSelection', 'surroundSelection'],
    ['tabOutOfClosers', 'tabOut'],
    ['smartIndentOnEnter', 'smartEnter'],
    ['indentOnPaste', 'indentOnPaste'],
    ['smartSemicolon', 'smartSemicolon'],
    ['camelHumps', 'camelHumps']
] as const satisfies readonly (readonly [keyof EditorSmartKeys, string])[];

/* What the editor does by itself as you type. */
export function SmartKeysSection() {
    const { t } = useTranslation('settings');
    const smartKeys = useSettings((s) => s.smartKeys);
    const update = useSettings((s) => s.update);

    return (
        <SettingsSection title={t('appearance.smartKeys.title')}>
            {KEYS.map(([key, words]) => (
                <SettingsRow
                    key={key}
                    searchId={`appearance.smartKeys.${words}`}
                    label={t(`appearance.smartKeys.${words}.label`)}
                    description={t(`appearance.smartKeys.${words}.description`)}
                    control={
                        <Switch
                            checked={smartKeys[key]}
                            onCheckedChange={(checked) => update({ smartKeys: { ...smartKeys, [key]: checked } })}
                            label={t(`appearance.smartKeys.${words}.label`)}
                        />
                    }
                />
            ))}
        </SettingsSection>
    );
}
