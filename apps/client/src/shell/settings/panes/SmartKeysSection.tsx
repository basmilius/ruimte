import { useTranslation } from 'react-i18next';
import type { EditorSmartKeys } from '@ruimte/smart-editor';
import { SettingsRow } from '@adecore/ui/settings';
import { Switch } from '@adecore/ui';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useSettings } from '@/state/settings';

/* The switch of each key and the words under `editor.smartKeys.<words>`. Camel humps move the caret and sit under General. */
const KEYS = [
    ['autoPairBrackets', 'pairBrackets'],
    ['autoPairQuotes', 'pairQuotes'],
    ['surroundSelection', 'surroundSelection'],
    ['tabOutOfClosers', 'tabOut'],
    ['smartIndentOnEnter', 'smartEnter'],
    ['indentOnPaste', 'indentOnPaste'],
    ['smartSemicolon', 'smartSemicolon']
] as const satisfies readonly (readonly [keyof EditorSmartKeys, string])[];

/* What the editor does by itself as you type. */
export function SmartKeysSection() {
    const { t } = useTranslation('settings');
    const smartKeys = useSettings((s) => s.smartKeys);
    const update = useSettings((s) => s.update);

    return (
        <SettingsSection title={t('editor.smartKeys.title')}>
            {KEYS.map(([key, words]) => (
                <SettingsRow
                    key={key}
                    searchId={`editor.smartKeys.${words}`}
                    label={t(`editor.smartKeys.${words}.label`)}
                    description={t(`editor.smartKeys.${words}.description`)}
                    control={
                        <Switch
                            checked={smartKeys[key]}
                            onCheckedChange={(checked) => update({ smartKeys: { ...smartKeys, [key]: checked } })}
                            label={t(`editor.smartKeys.${words}.label`)}
                        />
                    }
                />
            ))}
        </SettingsSection>
    );
}
