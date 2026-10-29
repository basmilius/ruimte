import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { isApplePlatform } from '@/desktop/bridge';
import { AccountTab } from '@/shell/settings/AccountTab';
import { findSettings } from '@/shell/settings/find-settings';
import {
    ABOUT_SECTION,
    ACCOUNT_SECTION,
    SETTINGS_GROUPS,
    groupLabel,
    sectionDescription,
    sectionLabel,
    type SettingsSectionMeta
} from '@/shell/settings/sections';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { useUi, type SettingsSectionId } from '@/state/ui';
import { SettingsDialog as Dialog, type SettingsSectionEntry } from '@adecore/ui/settings';
import { formatShortcut, lazyNamed } from '@adecore/ui';

// Each pane is a chunk of its own, loaded when it is opened; the search index in `search.ts` never imports one.
const PANES: Record<SettingsSectionId, ComponentType> = {
    appearance: lazyNamed(() => import('@/shell/settings/panes/AppearancePane'), 'AppearancePane'),
    editor: lazyNamed(() => import('@/shell/settings/panes/EditorPane'), 'EditorPane'),
    terminal: lazyNamed(() => import('@/shell/settings/panes/TerminalPane'), 'TerminalPane'),
    views: lazyNamed(() => import('@/shell/settings/panes/ViewsPane'), 'ViewsPane'),
    pets: lazyNamed(() => import('@/shell/settings/panes/PetsPane'), 'PetsPane'),
    files: lazyNamed(() => import('@/shell/settings/panes/FilesPane'), 'FilesPane'),
    storage: lazyNamed(() => import('@/shell/settings/panes/StoragePane'), 'StoragePane'),
    providers: lazyNamed(() => import('@/shell/settings/panes/ProvidersPane'), 'ProvidersPane'),
    voice: lazyNamed(() => import('@/shell/settings/panes/VoicePane'), 'VoicePane'),
    computer: lazyNamed(() => import('@/shell/settings/panes/ComputerPane'), 'ComputerPane'),
    usage: lazyNamed(() => import('@/shell/settings/panes/UsagePane'), 'UsagePane'),
    agents: lazyNamed(() => import('@/shell/settings/panes/AgentsPane'), 'AgentsPane'),
    machines: lazyNamed(() => import('@/shell/settings/panes/MachinesPane'), 'MachinesPane'),
    keyboard: lazyNamed(() => import('@/shell/settings/panes/KeyboardPane'), 'KeyboardPane'),
    about: lazyNamed(() => import('@/shell/settings/panes/AboutPane'), 'AboutPane')
};

// From the pane's own module, so a hero loads with its pane.
const HEROES: Partial<Record<SettingsSectionId, ComponentType>> = {
    about: lazyNamed(() => import('@/shell/settings/panes/AboutPane'), 'AboutHero')
};

// Built on every render rather than once: the words move with the language, the list does not.
function entryOf(meta: SettingsSectionMeta): SettingsSectionEntry {
    return {
        id: meta.id,
        icon: meta.icon,
        label: sectionLabel(meta.id),
        description: sectionDescription(meta.id),
        pane: PANES[meta.id],
        split: meta.split,
        hero: HEROES[meta.id]
    };
}

/* Ruimte's sections, search and account in the settings dialog of @adecore/ui. Opens on the section the caller asked for, or the last one. */
export function SettingsDialog() {
    const open = useUi((s) => s.settings.open);
    const section = useUi((s) => s.settings.section);
    const target = useUi((s) => s.settings.target);
    const searchAt = useUi((s) => s.settings.searchAt);
    const setSettings = useUi((s) => s.setSettings);
    // The labels come from `i18next.t`, which no redraw follows: this one is what draws them again in a language picked here.
    useTranslation('settings');

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => setSettings({ open: next })}
            section={section}
            onNavigate={({ section: next, target: row }) => setSettings({ section: next as SettingsSectionId, ...(row === undefined ? {} : { target: row }) })}
            groups={SETTINGS_GROUPS.map((group) => ({ label: group.label === null ? null : groupLabel(group.label), sections: group.sections.map(entryOf) }))}
            footer={[entryOf(ABOUT_SECTION)]}
            account={{ section: entryOf(ACCOUNT_SECTION), tab: <AccountTab /> }}
            search={{
                find: (query) => findSettings(query, isApplePlatform()),
                hint: formatShortcut(APP_SHORTCUTS.settingsSearch, isApplePlatform()),
                focusAt: searchAt
            }}
            target={target}
            onTargetShown={() => setSettings({ target: null })}
        />
    );
}
