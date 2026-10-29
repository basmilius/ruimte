import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Select } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { FontSection } from '@/shell/settings/panes/FontSection';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { SettingSwitchRow } from '@/shell/settings/SettingSwitchRow';
import { useSettings } from '@/state/settings';
import { AccentRow, PaletteRow } from '@/shell/settings/panes/ColorRows';
import { useTheme, type Theme } from '@/state/theme';

const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

/*
 * A light or a dark window in miniature, drawn in the tokens of that side whatever the app is in now.
 * The palette's stylesheet reaches every element that sets a side, so the accent is the person's own.
 */
function ThemeSample({ side, half }: { side: 'light' | 'dark'; half: boolean }) {
    return (
        <span data-theme={side} className="flex min-w-0 grow flex-col gap-1.5 bg-surface-raised p-2.5">
            <span className={clsx('h-1.5 rounded-full bg-surface-active', half ? 'w-2/3' : 'w-3/5')} />
            <span className={clsx('h-1.5 rounded-full bg-surface-hover', half ? 'w-1/2' : 'w-2/5')} />
            {!half && <AccentMark className="mt-auto self-end" />}
        </span>
    );
}

function AccentMark({ className }: { className: string }) {
    return <span className={clsx('h-3 w-7 rounded-full bg-accent', className)} />;
}

function ThemePicker() {
    const { t } = useTranslation('settings');
    const theme = useTheme((state) => state.theme);
    const setTheme = useTheme((state) => state.setTheme);
    return (
        <div className="flex flex-wrap gap-3.5" role="radiogroup" aria-label={t('appearance.theme.label')}>
            {THEMES.map((id) => (
                <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={theme === id}
                    className="flex flex-col items-center gap-2 rounded-lg"
                    onClick={() => setTheme(id)}
                >
                    <span
                        className={clsx(
                            'relative flex h-24 w-39 overflow-hidden rounded-[10px]',
                            theme === id ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'ring-1 ring-border-strong'
                        )}
                    >
                        {id === 'system' ? (
                            <>
                                <ThemeSample side="light" half />
                                <ThemeSample side="dark" half />
                                {/* Across the split, since the accent is the same on either side. */}
                                <AccentMark className="absolute bottom-2.5 left-1/2 -translate-x-1/2" />
                            </>
                        ) : (
                            <ThemeSample side={id} half={false} />
                        )}
                    </span>
                    <span className={clsx('text-xs', theme === id ? 'text-text' : 'text-text-muted')}>{t(`appearance.theme.options.${id}`)}</span>
                </button>
            ))}
        </div>
    );
}

export function AppearancePane() {
    const { t } = useTranslation('settings');
    const panelLayout = useSettings((s) => s.panelLayout);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingsSection title={t('appearance.theme.title')}>
                <SettingsRow searchId="appearance.theme" label={t('appearance.theme.label')} description={t('appearance.theme.description')}>
                    <ThemePicker />
                </SettingsRow>
                <SettingsRow
                    searchId="appearance.palette"
                    label={t('appearance.palette.label')}
                    description={t('appearance.palette.description')}
                    control={<PaletteRow />}
                />
                <SettingsRow
                    searchId="appearance.accent"
                    label={t('appearance.accent.label')}
                    description={t('appearance.accent.description')}
                    control={<AccentRow />}
                />
            </SettingsSection>
            <SettingsSection title={t('appearance.interface.title')}>
                <SettingsRow
                    searchId="appearance.interface.layout"
                    label={t('appearance.interface.layout.label')}
                    description={t('appearance.interface.layout.description')}
                    control={
                        <Select
                            value={panelLayout}
                            label={t('appearance.interface.layout.label')}
                            align="end"
                            items={(['standard', 'roomy'] as const).map((value) => ({ value, label: t(`appearance.interface.layout.${value}`) }))}
                            onValueChange={(value) => update({ panelLayout: value })}
                        />
                    }
                />
                <SettingSwitchRow id="appearance.projectGlow" setting="projectGlow" />
            </SettingsSection>
            <FontSection />
        </>
    );
}
