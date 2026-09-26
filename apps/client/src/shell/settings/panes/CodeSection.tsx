import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { highlightCode } from '@/shell/panels/highlight';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Toggle } from '@/shell/settings/controls';
import { codeThemesOf, useSettings } from '@/state/settings';
import { useTheme } from '@/state/theme';
import { Select } from '@ruimte/ui/Select';

const PREVIEW_CODE = [
    '// Greets a visitor by name.',
    'interface Visitor { name: string; visits: number }',
    '',
    'export function greet(visitor: Visitor): string {',
    "    const times = visitor.visits > 1 ? `${visitor.visits} times` : 'once';",
    '    return `Hello ${visitor.name}, seen ${times}.`;',
    '}'
].join('\n');

/* A few lines in a theme, on the code background of the app's side it is for, which is what the viewer and the editor draw it on. */
function CodeThemePreview({ theme, mode, label }: { theme: string; mode: 'light' | 'dark'; label: string }) {
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

    return (
        <div className="code-theme-preview overflow-hidden rounded-lg border border-border bg-clip-padding" role="img" aria-label={label}>
            {/* The side's own tokens, so the light theme is judged on the light background while the app is dark. */}
            <div data-theme={mode}>
                {html === null ? (
                    // The plain lines hold the same height until the highlighted ones arrive, so the pane does not jump.
                    <pre>
                        <code>
                            {PREVIEW_CODE.split('\n').map((line, index) => (
                                <span key={index} className="line">
                                    {line}
                                </span>
                            ))}
                        </code>
                    </pre>
                ) : (
                    <div dangerouslySetInnerHTML={{ __html: html }} />
                )}
            </div>
        </div>
    );
}

/* How code reads in the file viewer, the editor and a chat: its colors under either theme of the app, and whether long lines wrap. */
export function CodeSection() {
    const { t } = useTranslation('settings');
    const codeThemeLight = useSettings((s) => s.codeThemeLight);
    const codeThemeDark = useSettings((s) => s.codeThemeDark);
    const codeWrap = useSettings((s) => s.codeWrap);
    const update = useSettings((s) => s.update);
    const side = useTheme((s) => s.resolved);
    const lightThemes = codeThemesOf('light').map((info) => ({ value: info.id, label: info.displayName }));
    const darkThemes = codeThemesOf('dark').map((info) => ({ value: info.id, label: info.displayName }));
    // One preview, under the theme of the side the app is on now; switching the app's theme shows the other.
    const [themes, shown] = side === 'light' ? [lightThemes, codeThemeLight] : [darkThemes, codeThemeDark];
    const preview = (
        <CodeThemePreview
            theme={shown}
            mode={side}
            label={t('appearance.code.preview', { theme: themes.find((theme) => theme.value === shown)?.label ?? shown })}
        />
    );

    return (
        <SettingsSection title={t('appearance.code.title')}>
            <SettingsRow
                searchId="appearance.code.light"
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
                {side === 'light' && preview}
            </SettingsRow>
            <SettingsRow
                searchId="appearance.code.dark"
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
                {side === 'dark' && preview}
            </SettingsRow>
            <SettingsRow
                searchId="appearance.code.wrap"
                label={t('appearance.code.wrap.label')}
                description={t('appearance.code.wrap.description')}
                control={<Toggle checked={codeWrap} onChange={(checked) => update({ codeWrap: checked })} label={t('appearance.code.wrap.label')} />}
            />
        </SettingsSection>
    );
}
