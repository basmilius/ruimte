import { formatShortcut, isApplePlatform } from '@adecore/ui';
import { SettingsDialog as Dialog, type SettingsSectionEntry } from '@adecore/ui/settings';
import { useTranslation } from 'react-i18next';
import { AccountTab } from '@/machine-ui/AccountTab';
import { settingsSectionRegistry } from '@/registry/settings-sections';
import { findSettings } from '@/settings/find-settings';
import { aboutSection, accountSection, groupLabel, sectionDescription, sectionLabel, settingsGroupsWith, type SettingsSectionMeta } from '@/settings/sections';
import { useContributions, type SettingsSectionContribution } from '@/state/extension-registry';
import { useUi, type SettingsSectionId } from '@/state/ui';
import { useKeyOf } from '@/surface/shortcut-overrides';

// Built on every render rather than once: the words move with the language, the list does not.
function entryOf(meta: SettingsSectionMeta, contributed: readonly SettingsSectionContribution[]): SettingsSectionEntry {
    const definition = settingsSectionRegistry.find(meta.id);
    return {
        id: meta.id,
        icon: meta.icon,
        label: sectionLabel(meta.id),
        description: sectionDescription(meta.id),
        pane: contributed.find((section) => section.id === meta.id)?.component ?? definition!.pane,
        split: meta.split,
        hero: definition?.hero
    };
}

/* Ruimte's sections, search and account in the settings dialog of @adecore/ui. Opens on the section the caller asked for, or the last one. */
export function SettingsDialog() {
    const open = useUi((s) => s.settings.open);
    const section = useUi((s) => s.settings.section);
    const target = useUi((s) => s.settings.target);
    const searchAt = useUi((s) => s.settings.searchAt);
    const setSettings = useUi((s) => s.setSettings);
    const searchKey = useKeyOf('settings-search');
    const contributed = useContributions((state) => state.settingsSections);
    settingsSectionRegistry.useAll();
    // The labels come from `i18next.t`, which no redraw follows: this one is what draws them again in a language picked here.
    useTranslation('settings');

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => setSettings({ open: next })}
            section={section}
            onNavigate={({ section: next, target: row }) => setSettings({ section: next as SettingsSectionId, ...(row === undefined ? {} : { target: row }) })}
            groups={settingsGroupsWith(contributed).map((group) => ({
                label: group.label === null ? null : groupLabel(group.label),
                sections: group.sections.map((meta) => entryOf(meta, contributed))
            }))}
            footer={[entryOf(aboutSection(), contributed)]}
            account={{ section: entryOf(accountSection(), contributed), tab: <AccountTab sectionId={accountSection().id} /> }}
            search={{
                find: (query) => findSettings(query, isApplePlatform()),
                hint: formatShortcut(searchKey, isApplePlatform()),
                focusAt: searchAt
            }}
            target={target}
            onTargetShown={() => setSettings({ target: null })}
        />
    );
}
