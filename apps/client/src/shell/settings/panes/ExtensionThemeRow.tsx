import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useInstalledExtensions } from '@/extensions/loader';
import { activeExtensionTheme, chooseExtensionTheme, listExtensionThemes, type ThemeChoice } from '@/extensions/themes';

const NO_THEME = 'none';

/* Only there once an installed extension brings a theme. */
export function ExtensionThemeRow() {
    const { t } = useTranslation('settings');
    const installed = useInstalledExtensions((state) => state.installed);
    const [themes, setThemes] = useState<readonly ThemeChoice[]>([]);
    const [active, setActive] = useState(activeExtensionTheme);

    useEffect(() => {
        let current = true;

        void listExtensionThemes(installed).then((next) => {
            if (current) {
                setThemes(next);
            }
        });

        return () => {
            current = false;
        };
    }, [installed]);

    if (themes.length === 0) {
        return null;
    }

    return (
        <SettingsRow
            label={t('appearance.theme.extension.label')}
            description={t('appearance.theme.extension.description')}
            control={
                <Select
                    value={active ?? NO_THEME}
                    label={t('appearance.theme.extension.label')}
                    align="end"
                    items={[
                        { value: NO_THEME, label: t('appearance.theme.extension.none') },
                        ...themes.map((theme) => ({ value: theme.key, label: theme.name }))
                    ]}
                    onValueChange={(next) => {
                        chooseExtensionTheme(themes.find((theme) => theme.key === next) ?? null);
                        setActive(next === NO_THEME ? null : next);
                    }}
                />
            }
        />
    );
}
