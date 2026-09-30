import { useTranslation } from 'react-i18next';
import { Select, Stepper, Switch } from '@basmilius/desktop-ui';
import { SettingsRow } from '@basmilius/desktop-ui/settings';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { FONT_SIZE_RANGE, INTERFACE_FONT_SIZE_RANGE, INTERFACE_FONTS, MONO_FONTS, useSettings } from '@/state/settings';

function TerminalPreview({ fontSize }: { fontSize: number }) {
    return (
        <div
            className="overflow-x-auto rounded-lg bg-term-bg px-3.5 py-3 font-mono leading-normal whitespace-pre text-term-fg"
            style={{ fontSize: `${fontSize}px` }}
            aria-hidden
        >
            <span className="text-term-green">~/Development/ruimte</span> <span className="text-term-blue">main</span> ❯ bun run dev
            {'\n'}
            <span className="text-term-dim">ready in 412 ms</span>
        </div>
    );
}

/* The faces of the interface and of terminals and code, their sizes, and whether code draws ligatures. */
export function FontSection() {
    const { t } = useTranslation('settings');
    const interfaceFont = useSettings((s) => s.interfaceFont);
    const interfaceFontSize = useSettings((s) => s.interfaceFontSize);
    const font = useSettings((s) => s.font);
    const fontSize = useSettings((s) => s.fontSize);
    const codeLigatures = useSettings((s) => s.codeLigatures);
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
            <SettingsRow
                searchId="appearance.font.terminalSize"
                label={t('appearance.font.terminalSize.label')}
                control={
                    <Stepper
                        value={fontSize}
                        min={FONT_SIZE_RANGE.min}
                        max={FONT_SIZE_RANGE.max}
                        step={FONT_SIZE_RANGE.step}
                        unit=" px"
                        label={t('appearance.font.terminalSize.label')}
                        onValueChange={(value) => update({ fontSize: value })}
                    />
                }
            >
                <TerminalPreview fontSize={fontSize} />
            </SettingsRow>
            <SettingsRow
                searchId="appearance.font.ligatures"
                label={t('appearance.font.ligatures.label')}
                description={t('appearance.font.ligatures.description')}
                control={
                    <Switch
                        checked={codeLigatures}
                        onCheckedChange={(checked) => update({ codeLigatures: checked })}
                        label={t('appearance.font.ligatures.label')}
                    />
                }
            />
        </SettingsSection>
    );
}
