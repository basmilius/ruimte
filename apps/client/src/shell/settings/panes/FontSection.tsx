import { Select, Stepper } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useTranslation } from 'react-i18next';
import { INTERFACE_FONT_SIZE_RANGE, INTERFACE_FONTS, useSettings } from '@/state/settings';
import { SettingsSection } from '@/surface/settings/SettingsSection';

/* The font and the size of the interface. */
export function FontSection() {
    const { t } = useTranslation('settings');
    const interfaceFont = useSettings((s) => s.interfaceFont);
    const interfaceFontSize = useSettings((s) => s.interfaceFontSize);
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
        </SettingsSection>
    );
}
