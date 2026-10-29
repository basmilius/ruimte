import { useTranslation } from 'react-i18next';
import { formatDayClock, useFormatLocale, formatMoney, FORMAT_LANGUAGE, FORMAT_REGION_CHOICES, FORMAT_SYSTEM, regionName } from '@adecore/ui/format';
import { Input, Select } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { chooseLanguage, chooseRegion } from '@/i18n';
import { APP_LANGUAGES, LANGUAGE_LABELS, LANGUAGE_SYSTEM } from '@/i18n/languages';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { SettingSwitchRow } from '@/shell/settings/SettingSwitchRow';
import { useSettings } from '@/state/settings';

/* A date with a weekday, a month and a clock, so every part a region writes differently is in it. */
const EXAMPLE_MOMENT = new Date(2026, 8, 19, 14, 30);

/* The language the interface is written in. A language Ruimte does not speak yet is not on the
   list, so what the system asks for falls back to English rather than to half a translation. */
function LanguageRow() {
    const { t } = useTranslation('settings');
    const language = useSettings((s) => s.language);

    return (
        <SettingsRow
            searchId="general.language"
            label={t('general.language.label')}
            description={t('general.language.description')}
            control={
                <Select
                    value={language}
                    label={t('general.language.label')}
                    align="end"
                    items={[
                        { value: LANGUAGE_SYSTEM, label: t('general.language.system') },
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
            return t('general.region.language');
        }
        if (choice === FORMAT_SYSTEM) {
            return t('general.region.system');
        }
        return regionName(choice, i18n.language);
    };

    return (
        <SettingsRow
            searchId="general.region"
            label={t('general.region.label')}
            description={t('general.region.description', { example: `${formatDayClock(EXAMPLE_MOMENT)}, ${formatMoney(1234.5, 'USD')}` })}
            control={
                <Select
                    value={region}
                    label={t('general.region.label')}
                    align="end"
                    items={FORMAT_REGION_CHOICES.map((choice) => ({ value: choice, label: label(choice) }))}
                    onValueChange={chooseRegion}
                />
            }
        />
    );
}

/* What the whole app does whatever it looks like: its language, how projects sit in a window, and where browsing starts. */
export function GeneralPane() {
    const { t } = useTranslation('settings');
    const projectNavigation = useSettings((s) => s.projectNavigation);
    const sidebarScope = useSettings((s) => s.sidebarScope);
    const dockAutoHide = useSettings((s) => s.dockAutoHide);
    const browseStartFolder = useSettings((s) => s.browseStartFolder);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingsSection title={t('general.languageRegion.title')}>
                <LanguageRow />
                <RegionRow />
            </SettingsSection>
            <SettingsSection title={t('general.projects.title')}>
                <SettingsRow
                    searchId="general.projects"
                    label={t('general.projects.label')}
                    description={t('general.projects.description')}
                    control={
                        <Select
                            value={projectNavigation}
                            label={t('general.projects.label')}
                            align="end"
                            items={(['switcher', 'tabs'] as const).map((value) => ({ value, label: t(`general.projects.${value}`) }))}
                            onValueChange={(value) => update({ projectNavigation: value })}
                        />
                    }
                />
                <SettingsRow
                    searchId="general.sidebar"
                    label={t('general.sidebar.label')}
                    description={t('general.sidebar.description')}
                    control={
                        <Select
                            value={sidebarScope}
                            label={t('general.sidebar.label')}
                            align="end"
                            items={(['current', 'all-open'] as const).map((value) => ({ value, label: t(`general.sidebar.${value}`) }))}
                            onValueChange={(value) => update({ sidebarScope: value })}
                        />
                    }
                />
                {sidebarScope === 'current' && <SettingSwitchRow id="general.needsYou" setting="needsYouAllProjects" />}
                <SettingsRow
                    searchId="general.dock"
                    label={t('general.dock.label')}
                    description={t('general.dock.description')}
                    control={
                        <Select
                            value={dockAutoHide ? 'edge' : 'always'}
                            label={t('general.dock.label')}
                            align="end"
                            items={(['always', 'edge'] as const).map((value) => ({ value, label: t(`general.dock.${value}`) }))}
                            onValueChange={(value) => update({ dockAutoHide: value === 'edge' })}
                        />
                    }
                />
            </SettingsSection>
            <SettingsSection title={t('general.commandPalette.title')}>
                <SettingsRow searchId="general.browseStart" label={t('general.browseStart.label')} description={t('general.browseStart.description')}>
                    <Input
                        mono
                        aria-label={t('general.browseStart.label')}
                        placeholder="~/projects"
                        value={browseStartFolder}
                        spellCheck={false}
                        onChange={(e) => update({ browseStartFolder: e.target.value })}
                        onKeyDown={(e) => e.stopPropagation()}
                    />
                </SettingsRow>
            </SettingsSection>
        </>
    );
}
