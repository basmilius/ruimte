import { useTranslation } from 'react-i18next';
import { Stepper, Switch } from '@basmilius/desktop-ui';
import { SettingsRow } from '@basmilius/desktop-ui/settings';
import { CodeThemePreview } from '@/shell/settings/panes/CodeSection';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useCodeTheme } from '@/state/code-theme';
import { FONT_SIZE_RANGE, useSettings } from '@/state/settings';
import { useTheme } from '@/state/theme';

const CODE_SIZE_PREVIEW = ['export function greet(name: string): string {', '    return `Hello ${name}.`;', '}'].join('\n');

/* How code is drawn and how the caret moves through it, in the editor and, where the words say so, in files and diffs. */
export function EditorGeneralTab() {
    const { t } = useTranslation('settings');
    const codeFontSize = useSettings((s) => s.codeFontSize);
    const codeLigatures = useSettings((s) => s.codeLigatures);
    const codeWrap = useSettings((s) => s.codeWrap);
    const codeIndentGuides = useSettings((s) => s.codeIndentGuides);
    const codeWhitespace = useSettings((s) => s.codeWhitespace);
    const smartKeys = useSettings((s) => s.smartKeys);
    const update = useSettings((s) => s.update);
    const codeTheme = useCodeTheme();
    const side = useTheme((s) => s.resolved);

    return (
        <>
            <SettingsSection title={t('editor.general.font.title')}>
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
                            onValueChange={(value) => update({ codeFontSize: value })}
                        />
                    }
                >
                    <CodeThemePreview theme={codeTheme} mode={side} label={t('editor.general.font.size.preview')} code={CODE_SIZE_PREVIEW} />
                </SettingsRow>
                <SettingsRow
                    searchId="editor.general.font.ligatures"
                    label={t('editor.general.font.ligatures.label')}
                    description={t('editor.general.font.ligatures.description')}
                    control={
                        <Switch
                            checked={codeLigatures}
                            onCheckedChange={(checked) => update({ codeLigatures: checked })}
                            label={t('editor.general.font.ligatures.label')}
                        />
                    }
                />
            </SettingsSection>
            <SettingsSection title={t('editor.general.display.title')}>
                <SettingsRow
                    searchId="editor.general.display.wrap"
                    label={t('editor.general.display.wrap.label')}
                    description={t('editor.general.display.wrap.description')}
                    control={
                        <Switch
                            checked={codeWrap}
                            onCheckedChange={(checked) => update({ codeWrap: checked })}
                            label={t('editor.general.display.wrap.label')}
                        />
                    }
                />
                <SettingsRow
                    searchId="editor.general.display.indentGuides"
                    label={t('editor.general.display.indentGuides.label')}
                    description={t('editor.general.display.indentGuides.description')}
                    control={
                        <Switch
                            checked={codeIndentGuides}
                            onCheckedChange={(checked) => update({ codeIndentGuides: checked })}
                            label={t('editor.general.display.indentGuides.label')}
                        />
                    }
                />
                <SettingsRow
                    searchId="editor.general.display.whitespace"
                    label={t('editor.general.display.whitespace.label')}
                    description={t('editor.general.display.whitespace.description')}
                    control={
                        <Switch
                            checked={codeWhitespace}
                            onCheckedChange={(checked) => update({ codeWhitespace: checked })}
                            label={t('editor.general.display.whitespace.label')}
                        />
                    }
                />
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
        </>
    );
}
