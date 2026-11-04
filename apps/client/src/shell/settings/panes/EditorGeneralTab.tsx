import { Segmented, Select, Stepper, Switch } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useTranslation } from 'react-i18next';
import { RENDERED_DOC_COMMENTS } from '@/features';
import { CodeThemePreview } from '@/shell/settings/panes/CodeSection';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { SettingSwitchRow } from '@/shell/settings/SettingSwitchRow';
import { useCodeTheme } from '@/state/code-theme';
import { CODE_LINE_HEIGHT_RANGE, FONT_SIZE_RANGE, MONO_FONTS, TRAILING_WHITESPACE_MODES, type TrailingWhitespaceMode, useSettings } from '@/state/settings';
import { useTheme } from '@/state/theme';

const CODE_SIZE_PREVIEW = ['export function greet(name: string): string {', '    return `Hello ${name}.`;', '}'].join('\n');

/* How code is drawn and how the caret moves through it, in the editor and, where the words say so, in files and diffs. */
export function EditorGeneralTab() {
    const { t } = useTranslation('settings');
    const font = useSettings((s) => s.font);
    const codeFontSize = useSettings((s) => s.codeFontSize);
    const codeLineHeight = useSettings((s) => s.codeLineHeight);
    const smartKeys = useSettings((s) => s.smartKeys);
    const trailingWhitespace = useSettings((s) => s.codeTrailingWhitespace);
    const update = useSettings((s) => s.update);
    const codeTheme = useCodeTheme();
    const side = useTheme((s) => s.resolved);

    return (
        <>
            <SettingsSection title={t('editor.general.font.title')}>
                <SettingsRow
                    searchId="editor.general.font.family"
                    label={t('editor.general.font.family.label')}
                    description={t('editor.general.font.family.description')}
                    control={
                        <Select
                            value={font}
                            label={t('editor.general.font.family.label')}
                            align="end"
                            items={MONO_FONTS.map((entry) => ({
                                value: entry.id,
                                label: entry.id === 'system' ? t('editor.general.font.family.system') : entry.label
                            }))}
                            onValueChange={(value) => update({ font: value })}
                        />
                    }
                />
                <SettingsRow
                    searchId="editor.general.font.size"
                    label={t('editor.general.font.size.label')}
                    description={t('editor.general.font.size.description')}
                    control={
                        <Stepper
                            value={codeFontSize}
                            min={FONT_SIZE_RANGE.min}
                            max={FONT_SIZE_RANGE.max}
                            step={FONT_SIZE_RANGE.step}
                            unit=" px"
                            label={t('editor.general.font.size.label')}
                            onValueChange={(value) => update({ codeFontSize: value, codeZoom: null })}
                        />
                    }
                >
                    <CodeThemePreview theme={codeTheme} mode={side} label={t('editor.general.font.size.preview')} code={CODE_SIZE_PREVIEW} />
                </SettingsRow>
                <SettingsRow
                    searchId="editor.general.font.lineHeight"
                    label={t('editor.general.font.lineHeight.label')}
                    description={t('editor.general.font.lineHeight.description')}
                    control={
                        <Stepper
                            value={codeLineHeight}
                            min={CODE_LINE_HEIGHT_RANGE.min}
                            max={CODE_LINE_HEIGHT_RANGE.max}
                            step={CODE_LINE_HEIGHT_RANGE.step}
                            unit="×"
                            label={t('editor.general.font.lineHeight.label')}
                            onValueChange={(value) => update({ codeLineHeight: value })}
                        />
                    }
                />
                <SettingSwitchRow id="editor.general.font.ligatures" setting="codeLigatures" />
            </SettingsSection>
            <SettingsSection title={t('editor.general.display.title')}>
                <SettingSwitchRow id="editor.general.display.wrap" setting="codeWrap" />
                <SettingSwitchRow id="editor.general.display.indentGuides" setting="codeIndentGuides" />
                <SettingSwitchRow id="editor.general.display.whitespace" setting="codeWhitespace" />
                <SettingSwitchRow id="editor.general.display.stickyScroll" setting="codeStickyScroll" />
                <SettingsRow
                    muted
                    searchId="editor.general.display.rightMargin"
                    label={t('editor.general.display.rightMargin.label')}
                    description={t('editor.general.display.rightMargin.description')}
                />
            </SettingsSection>
            <SettingsSection title={t('editor.general.navigation.title')}>
                <SettingsRow
                    searchId="editor.general.navigation.camelHumps"
                    label={t('editor.general.navigation.camelHumps.label')}
                    description={t('editor.general.navigation.camelHumps.description')}
                    control={
                        <Switch
                            checked={smartKeys.camelHumps}
                            onCheckedChange={(checked) => update({ smartKeys: { ...smartKeys, camelHumps: checked } })}
                            label={t('editor.general.navigation.camelHumps.label')}
                        />
                    }
                />
            </SettingsSection>
            <SettingsSection title={t('editor.general.saving.title')}>
                <SettingsRow
                    searchId="editor.general.saving.trailingWhitespace"
                    label={t('editor.general.saving.trailingWhitespace.label')}
                    description={t('editor.general.saving.trailingWhitespace.description')}
                    control={
                        <Segmented<TrailingWhitespaceMode>
                            value={trailingWhitespace}
                            options={TRAILING_WHITESPACE_MODES.map((id) => ({ id, label: t(`editor.general.saving.trailingWhitespace.options.${id}`) }))}
                            label={t('editor.general.saving.trailingWhitespace.label')}
                            onValueChange={(value) => update({ codeTrailingWhitespace: value })}
                        />
                    }
                />
                <SettingSwitchRow id="editor.general.saving.ensureFinalNewline" setting="codeEnsureFinalNewline" />
            </SettingsSection>
            {RENDERED_DOC_COMMENTS && (
                <SettingsSection title={t('editor.general.documentation.title')}>
                    <SettingSwitchRow id="editor.general.documentation.render" setting="codeRenderDocs" />
                </SettingsSection>
            )}
            <SettingsSection title={t('editor.general.codeVision.title')}>
                <SettingSwitchRow id="editor.general.codeVision.usages" setting="codeVisionUsages" />
                <SettingSwitchRow id="editor.general.codeVision.authors" setting="codeVisionAuthors" />
            </SettingsSection>
        </>
    );
}
