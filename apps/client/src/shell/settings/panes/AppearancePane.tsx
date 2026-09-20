import clsx from 'clsx';
import { Menu } from '@base-ui-components/react/menu';
import { Check, Ellipsis } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { accentColor, accentLabel, FEATURED_ACCENTS, isFeatured, NODE_ACCENTS, type AccentId } from '@/canvas/accents';
import { formatDayClock } from '@/format/datetime';
import { useFormatLocale } from '@/format/locale';
import { formatMoney } from '@/format/number';
import { FORMAT_LANGUAGE, FORMAT_REGION_CHOICES, FORMAT_SYSTEM } from '@/format/regions';
import { chooseLanguage, chooseRegion } from '@/i18n';
import { APP_LANGUAGES, LANGUAGE_LABELS, LANGUAGE_SYSTEM } from '@/i18n/languages';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Segmented, Stepper, Toggle } from '@/shell/settings/controls';
import { FONT_SIZE_RANGE, INTERFACE_FONT_SIZE_RANGE, MONO_FONTS, useSettings } from '@/state/settings';
import { useTheme, type Theme } from '@/state/theme';
import { ACCENT_SWATCH } from '@/ui/classes';
import { Select } from '@/ui/Select';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';
import { MenuPopup } from '@/ui/MenuPopup';

/* A date with a weekday, a month and a clock, so every part a region writes differently is in it. */
const EXAMPLE_MOMENT = new Date(2026, 8, 19, 14, 30);

const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

/*
 * The accent, five colors at a time. Every Tailwind hue is on offer, which is more than a settings
 * row can carry, so the other twelve sit in a list behind them, in the order of the wheel; the trigger
 * wears the chosen color itself whenever that color is one of the ones it hides.
 */
function AccentSwatches() {
    const { t } = useTranslation('settings');
    const accent = useSettings((s) => s.accent);
    const update = useSettings((s) => s.update);
    const ring = 'ring-2 ring-accent ring-offset-2 ring-offset-surface';
    const featured = NODE_ACCENTS.filter((entry) => isFeatured(entry.id)).sort((a, b) => FEATURED_ACCENTS.indexOf(a.id) - FEATURED_ACCENTS.indexOf(b.id));
    const rest = NODE_ACCENTS.filter((entry) => !isFeatured(entry.id));
    const hidden = isFeatured(accent) ? null : accent;
    const pick = (id: AccentId): void => update({ accent: id });
    return (
        <div className="flex items-center gap-2" role="radiogroup" aria-label={t('appearance.accent.label')}>
            {featured.map((entry) => (
                <Tooltip key={entry.id} label={accentLabel(entry.id)}>
                    <button
                        role="radio"
                        aria-checked={accent === entry.id}
                        aria-label={accentLabel(entry.id)}
                        className={clsx(ACCENT_SWATCH, accent === entry.id && ring)}
                        style={{ background: entry.color }}
                        onClick={() => pick(entry.id)}
                    >
                        {accent === entry.id && <Icon icon={Check} size={12} />}
                    </button>
                </Tooltip>
            ))}
            <Menu.Root>
                <Tooltip label={t('appearance.accent.more')}>
                    <Menu.Trigger
                        aria-label={t('appearance.accent.more')}
                        className={clsx(ACCENT_SWATCH, hidden ? ring : 'border border-border-strong text-text-muted')}
                        style={hidden ? { background: accentColor(hidden) } : undefined}
                    >
                        <Icon icon={hidden ? Check : Ellipsis} size={12} />
                    </Menu.Trigger>
                </Tooltip>
                <MenuPopup align="end" className="max-h-96 overflow-y-auto">
                    <Menu.RadioGroup value={accent} onValueChange={(value: AccentId) => pick(value)}>
                        {rest.map((entry) => (
                            <Menu.RadioItem key={entry.id} value={entry.id} className="menu-item">
                                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: entry.color }} aria-hidden />
                                <span className="grow">{accentLabel(entry.id)}</span>
                                <span className="grid h-5 w-4 shrink-0 place-items-center">
                                    <Menu.RadioItemIndicator>
                                        <Icon icon={Check} size={14} />
                                    </Menu.RadioItemIndicator>
                                </span>
                            </Menu.RadioItem>
                        ))}
                    </Menu.RadioGroup>
                </MenuPopup>
            </Menu.Root>
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
    const countries = new Intl.DisplayNames([i18n.language], { type: 'region' });
    const label = (choice: string): string => {
        if (choice === FORMAT_LANGUAGE) {
            return t('appearance.region.language');
        }
        if (choice === FORMAT_SYSTEM) {
            return t('appearance.region.system');
        }
        return countries.of(choice.slice(choice.indexOf('-') + 1)) ?? choice;
    };

    return (
        <SettingsRow
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
    const theme = useTheme((state) => state.theme);
    const setTheme = useTheme((state) => state.setTheme);
    const font = useSettings((s) => s.font);
    const fontSize = useSettings((s) => s.fontSize);
    const interfaceFontSize = useSettings((s) => s.interfaceFontSize);
    const dockAutoHide = useSettings((s) => s.dockAutoHide);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingsSection title={t('appearance.theme.title')}>
                <SettingsRow
                    label={t('appearance.theme.label')}
                    description={t('appearance.theme.description')}
                    control={
                        <Segmented
                            value={theme}
                            options={THEMES.map((id) => ({ id, label: t(`appearance.theme.options.${id}`) }))}
                            onChange={setTheme}
                            label={t('appearance.theme.label')}
                        />
                    }
                />
                <SettingsRow label={t('appearance.accent.label')} description={t('appearance.accent.description')} control={<AccentSwatches />} />
            </SettingsSection>
            <SettingsSection title={t('appearance.interface.title')}>
                <LanguageRow />
                <RegionRow />
                <SettingsRow
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
                    label={t('appearance.interface.dock.label')}
                    description={t('appearance.interface.dock.description')}
                    control={
                        <Toggle checked={dockAutoHide} onChange={(checked) => update({ dockAutoHide: checked })} label={t('appearance.interface.dock.label')} />
                    }
                />
            </SettingsSection>
            <SettingsSection title={t('appearance.terminal.title')}>
                <SettingsRow
                    label={t('appearance.terminal.font.label')}
                    description={t('appearance.terminal.font.description')}
                    control={
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
                    }
                />
                <SettingsRow
                    label={t('appearance.terminal.fontSize.label')}
                    control={
                        <Stepper
                            value={fontSize}
                            min={FONT_SIZE_RANGE.min}
                            max={FONT_SIZE_RANGE.max}
                            step={FONT_SIZE_RANGE.step}
                            unit=" px"
                            label={t('appearance.terminal.fontSize.label')}
                            onChange={(value) => update({ fontSize: value })}
                        />
                    }
                />
            </SettingsSection>
        </>
    );
}
