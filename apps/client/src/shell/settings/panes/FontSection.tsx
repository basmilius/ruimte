import { useTranslation } from 'react-i18next';
import { Select, Stepper } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { INTERFACE_FONT_SIZE_RANGE, INTERFACE_FONTS, MONO_FONTS, useSettings } from '@/state/settings';

/* Font families shared across the app, and the size of the interface. */
export function FontSection() {
    const { t } = useTranslation('settings');
    const interfaceFont = useSettings((s) => s.interfaceFont);
    const interfaceFontSize = useSettings((s) => s.interfaceFontSize);
    const font = useSettings((s) => s.font);
    const update = useSettings((s) => s.update);

    return (
        <SettingsSection title={t('appearance.font.title')}>
            <SettingsRow
                searchId="appearance.font.interface"
                label={t('appearance.font.interface.label')}
                description={t('appearance.font.interface.description')}
                control={
                    <Select
                        value={interfaceFont}
                        label={t('appearance.font.interface.label')}
                        align="end"
                        items={INTERFACE_FONTS.map((entry) => ({
                            value: entry.id,
                            label: entry.id === 'system' ? t('appearance.font.interface.system') : entry.label
                        }))}
                        onValueChange={(value) => update({ interfaceFont: value })}
                    />
                }
            />
            <SettingsRow
                searchId="appearance.font.interfaceSize"
                label={t('appearance.font.interfaceSize.label')}
                description={t('appearance.font.interfaceSize.description')}
                control={
                    <Stepper
                        value={interfaceFontSize}
                        min={INTERFACE_FONT_SIZE_RANGE.min}
                        max={INTERFACE_FONT_SIZE_RANGE.max}
                        step={INTERFACE_FONT_SIZE_RANGE.step}
                        unit=" px"
                        label={t('appearance.font.interfaceSize.label')}
                        onValueChange={(value) => update({ interfaceFontSize: value })}
                    />
                }
            />
            <SettingsRow
                searchId="appearance.font.mono"
                label={t('appearance.font.mono.label')}
                description={t('appearance.font.mono.description')}
                control={
                    <Select
                        value={font}
                        label={t('appearance.font.mono.label')}
                        align="end"
                        items={MONO_FONTS.map((entry) => ({
                            value: entry.id,
                            label: entry.id === 'system' ? t('appearance.font.mono.system') : entry.label
                        }))}
                        onValueChange={(value) => update({ font: value })}
                    />
                }
            />
        </SettingsSection>
    );
}
