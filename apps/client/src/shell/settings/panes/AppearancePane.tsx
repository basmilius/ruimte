import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { accentColor } from '@/canvas/accents';
import { formatDayClock } from '@/format/datetime';
import { useFormatLocale } from '@/format/locale';
import { formatMoney } from '@/format/number';
import { FORMAT_LANGUAGE, FORMAT_REGION_CHOICES, FORMAT_SYSTEM, regionName } from '@/format/regions';
import { chooseLanguage, chooseRegion } from '@/i18n';
import { APP_LANGUAGES, LANGUAGE_LABELS, LANGUAGE_SYSTEM } from '@/i18n/languages';
import { AccentSwatches } from '@/shell/settings/AccentSwatches';
import { CodeSection } from '@/shell/settings/panes/CodeSection';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Stepper, Toggle } from '@/shell/settings/controls';
import { FONT_SIZE_RANGE, INTERFACE_FONT_SIZE_RANGE, MONO_FONTS, useSettings } from '@/state/settings';
import { useTheme, type Theme } from '@/state/theme';
import { Select } from '@/ui/Select';

/* A date with a weekday, a month and a clock, so every part a region writes differently is in it. */
const EXAMPLE_MOMENT = new Date(2026, 8, 19, 14, 30);

const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

/*
 * A light or a dark window in miniature, drawn in the tokens of that side whatever the app is in now.
 * The accent is the person's own: the light side's tokens would put the brand blue back.
 */
function ThemeSample({ side, half, accent }: { side: 'light' | 'dark'; half: boolean; accent: string | undefined }) {
    return (
        <span data-theme={side} className="flex min-w-0 grow flex-col gap-1.5 bg-surface-raised p-2.5">
            <span className={clsx('h-1.5 rounded-full bg-surface-active', half ? 'w-2/3' : 'w-3/5')} />
            <span className={clsx('h-1.5 rounded-full bg-surface-hover', half ? 'w-1/2' : 'w-2/5')} />
            {!half && <AccentMark accent={accent} className="mt-auto self-end" />}
        </span>
    );
}

function AccentMark({ accent, className }: { accent: string | undefined; className: string }) {
    return <span className={clsx('h-3 w-7 rounded-full bg-accent', className)} style={accent ? { background: accent } : undefined} />;
}

function ThemePicker() {
    const { t } = useTranslation('settings');
    const theme = useTheme((state) => state.theme);
    const setTheme = useTheme((state) => state.setTheme);
    const accent = accentColor(useSettings((s) => s.accent));
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
                                <ThemeSample side="light" half accent={accent} />
                                <ThemeSample side="dark" half accent={accent} />
                                {/* Across the split, since the accent is the same on either side. */}
                                <AccentMark accent={accent} className="absolute bottom-2.5 left-1/2 -translate-x-1/2" />
                            </>
                        ) : (
                            <ThemeSample side={id} half={false} accent={accent} />
                        )}
                    </span>
                    <span className={clsx('text-xs', theme === id ? 'text-text' : 'text-text-muted')}>{t(`appearance.theme.options.${id}`)}</span>
                </button>
            ))}
        </div>
    );
}

/* The accent of the whole app, from the same swatches an agent account picks its color from. */
function AccentRow() {
    const { t } = useTranslation('settings');
    const accent = useSettings((s) => s.accent);
    const update = useSettings((s) => s.update);
    return <AccentSwatches value={accent} label={t('appearance.accent.label')} onChange={(id) => update({ accent: id })} />;
}

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
    const font = useSettings((s) => s.font);
    const fontSize = useSettings((s) => s.fontSize);
    const interfaceFontSize = useSettings((s) => s.interfaceFontSize);
    const sidebarScope = useSettings((s) => s.sidebarScope);
    const dockAutoHide = useSettings((s) => s.dockAutoHide);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingsSection title={t('appearance.theme.title')}>
                <SettingsRow searchId="appearance.theme" label={t('appearance.theme.label')} description={t('appearance.theme.description')}>
                    <ThemePicker />
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
                    searchId="appearance.interface.fontSize"
                    label={t('appearance.interface.fontSize.label')}
                    description={t('appearance.interface.fontSize.description')}
                    control={
                        <Stepper
                            value={interfaceFontSize}
                            min={INTERFACE_FONT_SIZE_RANGE.min}
                            max={INTERFACE_FONT_SIZE_RANGE.max}
                            step={INTERFACE_FONT_SIZE_RANGE.step}
                            unit=" px"
                            label={t('appearance.interface.fontSize.label')}
                            onChange={(value) => update({ interfaceFontSize: value })}
                        />
                    }
                />
                <SettingsRow
                    searchId="appearance.interface.dock"
                    label={t('appearance.interface.dock.label')}
                    description={t('appearance.interface.dock.description')}
                    control={
                        <Toggle checked={dockAutoHide} onChange={(checked) => update({ dockAutoHide: checked })} label={t('appearance.interface.dock.label')} />
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
            </SettingsSection>
            <SettingsSection title={t('appearance.languageRegion.title')}>
                <LanguageRow />
                <RegionRow />
            </SettingsSection>
            <SettingsSection title={t('appearance.terminal.title')}>
                <SettingsRow
                    searchId="appearance.terminal.font"
                    label={t('appearance.terminal.font.label')}
                    description={t('appearance.terminal.font.description')}
                    control={
                        <>
                            <Select
                                value={font}
                                label={t('appearance.terminal.font.label')}
                                align="end"
                                items={MONO_FONTS.map((entry) => ({
                                    value: entry.id,
                                    label: entry.id === 'system' ? t('appearance.terminal.font.system') : entry.label
                                }))}
                                onValueChange={(value) => update({ font: value })}
                            />
                            <Stepper
                                value={fontSize}
                                min={FONT_SIZE_RANGE.min}
                                max={FONT_SIZE_RANGE.max}
                                step={FONT_SIZE_RANGE.step}
                                unit=" px"
                                label={t('appearance.terminal.fontSize.label')}
                                onChange={(value) => update({ fontSize: value })}
                            />
                        </>
                    }
                >
                    <TerminalPreview fontSize={fontSize} />
                </SettingsRow>
            </SettingsSection>
            <CodeSection />
        </>
    );
}
