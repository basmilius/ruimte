import clsx from 'clsx';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { FEATURED_ACCENTS, NODE_ACCENTS, accentLabel } from '@/canvas/accents';
import { formatDayClock, useFormatLocale, formatMoney, FORMAT_LANGUAGE, FORMAT_REGION_CHOICES, FORMAT_SYSTEM, regionName } from '@adecore/ui/format';
import { AccentSwatches, Switch, Select } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { chooseLanguage, chooseRegion } from '@/i18n';
import { APP_LANGUAGES, LANGUAGE_LABELS, LANGUAGE_SYSTEM } from '@/i18n/languages';
import { FontSection } from '@/shell/settings/panes/FontSection';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useSettings } from '@/state/settings';
import { presetSample, type PalettePreset } from '@/state/palette-presets';
import { TAILWIND_COLORS, TAILWIND_NEUTRALS } from '@/state/tailwind-palettes';
import { useTheme, type Theme } from '@/state/theme';

/* A date with a weekday, a month and a clock, so every part a region writes differently is in it. */
const EXAMPLE_MOMENT = new Date(2026, 8, 19, 14, 30);

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

/* A preset's ground in miniature on the side the app is in now: the canvas, a panel on it and its text.
   Its tokens are set on the sample itself, since the page's own already carry the palette in use. */
function PaletteSample({ preset, side }: { preset: PalettePreset; side: 'light' | 'dark' }) {
    const tokens = presetSample(preset, side);
    const style = Object.fromEntries(Object.entries(tokens).map(([token, value]) => [`--${token}`, value])) as CSSProperties;
    return (
        <span style={style} className="flex h-12 w-19 items-end bg-canvas-bg p-1.5">
            <span className="flex w-full flex-col gap-1 rounded-sm bg-surface-raised p-1.5">
                <span className="h-1 w-3/4 rounded-full bg-text-muted" />
                <span className="h-1 w-1/2 rounded-full bg-text-faint" />
            </span>
        </span>
    );
}

function PaletteOption({ preset, side }: { preset: PalettePreset; side: 'light' | 'dark' }) {
    const { t } = useTranslation('settings');
    const palette = useSettings((s) => s.palette);
    const update = useSettings((s) => s.update);
    return (
        <button
            type="button"
            role="radio"
            aria-checked={palette === preset}
            className="flex flex-col items-center gap-1.5 rounded-lg"
            onClick={() => update({ palette: preset })}
        >
            <span
                className={clsx(
                    'flex overflow-hidden rounded-lg',
                    palette === preset ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'ring-1 ring-border-strong'
                )}
            >
                <PaletteSample preset={preset} side={side} />
            </span>
            <span className={clsx('text-xs', palette === preset ? 'text-text' : 'text-text-muted')}>{t(`appearance.palette.options.${preset}`)}</span>
        </button>
    );
}

/* The tint of the grounds, panels and text, beside the accent and apart from it: the grays on one line,
   the colors on the next. */
function PalettePicker() {
    const { t } = useTranslation('settings');
    const side = useTheme((state) => state.resolved);
    return (
        <div className="flex flex-col gap-3" role="radiogroup" aria-label={t('appearance.palette.label')}>
            {[['default', ...TAILWIND_NEUTRALS] as const, TAILWIND_COLORS].map((group) => (
                <div key={group[0]} className="flex flex-wrap gap-2.5">
                    {group.map((preset) => (
                        <PaletteOption key={preset} preset={preset} side={side} />
                    ))}
                </div>
            ))}
        </div>
    );
}

/* The accent of the whole app, from the same swatches an agent account picks its color from. */
function AccentRow() {
    const { t } = useTranslation('settings');
    const accent = useSettings((s) => s.accent);
    const update = useSettings((s) => s.update);
    return (
        <AccentSwatches
            value={accent}
            label={t('appearance.accent.label')}
            accents={NODE_ACCENTS}
            featured={FEATURED_ACCENTS}
            labelOf={accentLabel}
            onValueChange={(id) => update({ accent: id })}
        />
    );
}

/* The language the interface is written in. A language Ruimte does not speak yet is not on the
   list, so what the system asks for falls back to English rather than to half a translation. */
function LanguageRow() {
    const { t } = useTranslation('settings');
    const language = useSettings((s) => s.language);

    return (
        <SettingsRow
            searchId="appearance.language"
            label={t('appearance.language.label')}
            description={t('appearance.language.description')}
            control={
                <Select
                    value={language}
                    label={t('appearance.language.label')}
                    align="end"
                    items={[
                        { value: LANGUAGE_SYSTEM, label: t('appearance.language.system') },
                        // A language names itself, the way an operating system lists one, so whoever
                        // opened this by accident can find the way back.
                        ...APP_LANGUAGES.map((id) => ({ value: id, label: LANGUAGE_LABELS[id] }))
                    ]}
                    onValueChange={(value) => void chooseLanguage(value)}
                />
            }
        />
    );
}

/*
 * Which region writes the numbers, dates and times, a different question from the language. An
 * English interface on a Dutch machine still writes `08:05` and `1.234,5`. The example is the
 * setting, read back, so the choice is made on what it does and not on the name of a country.
 */
function RegionRow() {
    const { t, i18n } = useTranslation('settings');
    const region = useSettings((s) => s.formatRegion);
    // Subscribing is the point. The example below redraws when the region changes under it.
    useFormatLocale();
    const label = (choice: string): string => {
        if (choice === FORMAT_LANGUAGE) {
            return t('appearance.region.language');
        }
        if (choice === FORMAT_SYSTEM) {
            return t('appearance.region.system');
        }
        return regionName(choice, i18n.language);
    };

    return (
        <SettingsRow
            searchId="appearance.region"
            label={t('appearance.region.label')}
            description={t('appearance.region.description', { example: `${formatDayClock(EXAMPLE_MOMENT)}, ${formatMoney(1234.5, 'USD')}` })}
            control={
                <Select
                    value={region}
                    label={t('appearance.region.label')}
                    align="end"
                    items={FORMAT_REGION_CHOICES.map((choice) => ({ value: choice, label: label(choice) }))}
                    onValueChange={chooseRegion}
                />
            }
        />
    );
}

export function AppearancePane() {
    const { t } = useTranslation('settings');
    const panelLayout = useSettings((s) => s.panelLayout);
    const projectNavigation = useSettings((s) => s.projectNavigation);
    const sidebarScope = useSettings((s) => s.sidebarScope);
    const needsYouAllProjects = useSettings((s) => s.needsYouAllProjects);
    const projectGlow = useSettings((s) => s.projectGlow);
    const dockAutoHide = useSettings((s) => s.dockAutoHide);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingsSection title={t('appearance.theme.title')}>
                <SettingsRow searchId="appearance.theme" label={t('appearance.theme.label')} description={t('appearance.theme.description')}>
                    <ThemePicker />
                </SettingsRow>
                <SettingsRow searchId="appearance.palette" label={t('appearance.palette.label')} description={t('appearance.palette.description')}>
                    <PalettePicker />
                </SettingsRow>
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
                <SettingsRow
                    searchId="appearance.interface.projects"
                    label={t('appearance.interface.projects.label')}
                    description={t('appearance.interface.projects.description')}
                    control={
                        <Select
                            value={projectNavigation}
                            label={t('appearance.interface.projects.label')}
                            align="end"
                            items={(['switcher', 'tabs'] as const).map((value) => ({ value, label: t(`appearance.interface.projects.${value}`) }))}
                            onValueChange={(value) => update({ projectNavigation: value })}
                        />
                    }
                />
                <SettingsRow
                    searchId="appearance.interface.dock"
                    label={t('appearance.interface.dock.label')}
                    description={t('appearance.interface.dock.description')}
                    control={
                        <Switch
                            checked={dockAutoHide}
                            onCheckedChange={(checked) => update({ dockAutoHide: checked })}
                            label={t('appearance.interface.dock.label')}
                        />
                    }
                />
                <SettingsRow
                    searchId="appearance.sidebar"
                    label={t('appearance.sidebar.label')}
                    description={t('appearance.sidebar.description')}
                    control={
                        <Select
                            value={sidebarScope}
                            label={t('appearance.sidebar.label')}
                            align="end"
                            items={(['current', 'all-open'] as const).map((value) => ({ value, label: t(`appearance.sidebar.${value}`) }))}
                            onValueChange={(value) => update({ sidebarScope: value })}
                        />
                    }
                />
                <SettingsRow
                    searchId="appearance.projectGlow"
                    label={t('appearance.projectGlow.label')}
                    description={t('appearance.projectGlow.description')}
                    control={
                        <Switch
                            checked={projectGlow}
                            onCheckedChange={(checked) => update({ projectGlow: checked })}
                            label={t('appearance.projectGlow.label')}
                        />
                    }
                />
                {sidebarScope === 'current' && (
                    <SettingsRow
                        searchId="appearance.needsYou"
                        label={t('appearance.needsYou.label')}
                        description={t('appearance.needsYou.description')}
                        control={
                            <Switch
                                checked={needsYouAllProjects}
                                onCheckedChange={(checked) => update({ needsYouAllProjects: checked })}
                                label={t('appearance.needsYou.label')}
                            />
                        }
                    />
                )}
            </SettingsSection>
            <SettingsSection title={t('appearance.languageRegion.title')}>
                <LanguageRow />
                <RegionRow />
            </SettingsSection>
            <FontSection />
        </>
    );
}
