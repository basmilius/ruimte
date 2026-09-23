import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { highlightCode } from '@/shell/panels/highlight';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Toggle } from '@/shell/settings/controls';
import { codeThemesOf, useSettings } from '@/state/settings';
import { Select } from '@/ui/Select';

const PREVIEW_CODE = [
    '// Greets a visitor by name.',
    'interface Visitor { name: string; visits: number }',
    '',
    'export function greet(visitor: Visitor): string {',
    "    const times = visitor.visits > 1 ? `${visitor.visits} times` : 'once';",
    '    return `Hello ${visitor.name}, seen ${times}.`;',
    '}'
].join('\n');

/* A few lines in a theme, on the theme's own background, so a theme is picked by looking at it. */
function CodeThemePreview({ theme, label }: { theme: string; label: string }) {
    const [html, setHtml] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        highlightCode(PREVIEW_CODE, 'typescript', theme)
            .then((result) => {
                if (!cancelled) {
                    setHtml(result);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [theme]);

    // The plain lines hold the same height until the highlighted ones arrive, so the pane does not jump.
    if (html === null) {
        return (
            <div className="code-theme-preview rounded-lg border border-border bg-surface-sunken bg-clip-padding" role="img" aria-label={label}>
                <pre>
                    <code>
                        {PREVIEW_CODE.split('\n').map((line, index) => (
                            <span key={index} className="line">
                                {line}
                            </span>
                        ))}
                    </code>
                </pre>
            </div>
        );
    }
    return (
        <div
            className="code-theme-preview rounded-lg border border-border bg-clip-padding"
            role="img"
            aria-label={label}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}

/* How code reads in the file viewer, the editor and a chat: its colors under either theme of the app, and whether long lines wrap. */
export function CodeSection() {
    const { t } = useTranslation('settings');
    const codeThemeLight = useSettings((s) => s.codeThemeLight);
    const codeThemeDark = useSettings((s) => s.codeThemeDark);
    const codeWrap = useSettings((s) => s.codeWrap);
    const update = useSettings((s) => s.update);
    const lightThemes = codeThemesOf('light').map((info) => ({ value: info.id, label: info.displayName }));
    const darkThemes = codeThemesOf('dark').map((info) => ({ value: info.id, label: info.displayName }));
    const previewLabel = (themes: { value: string; label: string }[], id: string): string =>
        t('appearance.code.preview', { theme: themes.find((theme) => theme.value === id)?.label ?? id });

    return (
        <SettingsSection title={t('appearance.code.title')}>
            <SettingsRow
                label={t('appearance.code.light.label')}
                description={t('appearance.code.light.description')}
                control={
                    <Select
                        value={codeThemeLight}
                        label={t('appearance.code.light.label')}
                        align="end"
                        items={lightThemes}
                        onValueChange={(value) => update({ codeThemeLight: value })}
                    />
                }
            >
                <CodeThemePreview theme={codeThemeLight} label={previewLabel(lightThemes, codeThemeLight)} />
            </SettingsRow>
            <SettingsRow
                label={t('appearance.code.dark.label')}
                description={t('appearance.code.dark.description')}
                control={
                    <Select
                        value={codeThemeDark}
                        label={t('appearance.code.dark.label')}
                        align="end"
                        items={darkThemes}
                        onValueChange={(value) => update({ codeThemeDark: value })}
                    />
                }
            >
                <CodeThemePreview theme={codeThemeDark} label={previewLabel(darkThemes, codeThemeDark)} />
            </SettingsRow>
            <SettingsRow
                label={t('appearance.code.wrap.label')}
                description={t('appearance.code.wrap.description')}
                control={<Toggle checked={codeWrap} onChange={(checked) => update({ codeWrap: checked })} label={t('appearance.code.wrap.label')} />}
            />
        </SettingsSection>
    );
}
