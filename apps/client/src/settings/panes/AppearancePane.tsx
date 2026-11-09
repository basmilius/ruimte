import { Select } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInstalledExtensions } from '@/extensions/loader';
import { chooseExtensionTheme, listExtensionThemes, type ThemeChoice } from '@/extensions/themes';
import { SettingsSection } from '@/machines/SettingsSection';
import { AccentRow, PaletteRow } from '@/settings/panes/ColorRows';
import { FontSection } from '@/settings/panes/FontSection';
import { useContributions } from '@/state/extension-registry';
import { useExtensionTheme } from '@/state/extension-theme';
import { useSettings } from '@/state/settings';
import { useTheme, type Theme } from '@/state/theme';
import { SettingSwitchRow } from '@/surface/SettingSwitchRow';

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

/* The themes that enabled extensions bring, loaded again when what is installed changes. */
function useExtensionThemes(): readonly ThemeChoice[] {
    const installed = useInstalledExtensions((state) => state.installed);
    const builtInThemes = useContributions((state) => state.builtInThemes);
    const [themes, setThemes] = useState<readonly ThemeChoice[]>([]);

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
    }, [installed, builtInThemes]);

    return themes;
}

function sampleFrame(checked: boolean): string {
    return clsx(
        'relative flex h-24 w-39 overflow-hidden rounded-[10px]',
        checked ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'ring-1 ring-border-strong'
    );
}

function ThemePicker() {
    const { t } = useTranslation('settings');
    const theme = useTheme((state) => state.theme);
    const setTheme = useTheme((state) => state.setTheme);
    const extensionTheme = useExtensionTheme((state) => state.key);
    const extensionThemes = useExtensionThemes();
    return (
        <div className="flex flex-wrap gap-3.5" role="radiogroup" aria-label={t('appearance.theme.label')}>
            {THEMES.map((id) => (
                <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={extensionTheme === null && theme === id}
                    className="flex flex-col items-center gap-2 rounded-lg"
                    onClick={() => {
                        chooseExtensionTheme(null);
                        setTheme(id);
                    }}
                >
                    <span className={sampleFrame(extensionTheme === null && theme === id)}>
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
                    <span className={clsx('text-xs', extensionTheme === null && theme === id ? 'text-text' : 'text-text-muted')}>
                        {t(`appearance.theme.options.${id}`)}
                    </span>
                </button>
            ))}
            {extensionThemes.map((choice) => (
                <button
                    key={choice.key}
                    type="button"
                    role="radio"
                    aria-checked={extensionTheme === choice.key}
                    className="flex flex-col items-center gap-2 rounded-lg"
                    onClick={() => chooseExtensionTheme(choice)}
                >
                    <span className={sampleFrame(extensionTheme === choice.key)}>
                        <img src={choice.thumbnailUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                    </span>
                    <span className={clsx('max-w-39 truncate text-xs', extensionTheme === choice.key ? 'text-text' : 'text-text-muted')}>{choice.name}</span>
                </button>
            ))}
        </div>
    );
}

export function AppearancePane() {
    const { t } = useTranslation('settings');
    const extensionTheme = useExtensionTheme((state) => state.key);
    const panelLayout = useSettings((s) => s.panelLayout);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingsSection title={t('appearance.theme.title')}>
                <SettingsRow searchId="appearance.theme" label={t('appearance.theme.label')} description={t('appearance.theme.description')}>
                    <ThemePicker />
                </SettingsRow>
                {extensionTheme === null && (
                    <SettingsRow
                        searchId="appearance.palette"
                        label={t('appearance.palette.label')}
                        description={t('appearance.palette.description')}
                        control={<PaletteRow />}
                    />
                )}
                <SettingsRow
                    searchId="appearance.accent"
                    label={t('appearance.accent.label')}
                    description={t('appearance.accent.description')}
                    control={<AccentRow />}
                />
                <SettingSwitchRow id="appearance.accentFollowsProject" setting="accentFollowsProject" />
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
                <SettingSwitchRow id="appearance.scrollBounce" setting="scrollBounce" />
            </SettingsSection>
            <FontSection />
        </>
    );
}
