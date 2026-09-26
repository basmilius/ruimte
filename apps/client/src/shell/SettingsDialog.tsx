import type { ComponentType } from 'react';
import { isApplePlatform } from '@/desktop/bridge';
import { AccountTab } from '@/shell/settings/AccountTab';
import { keyboardGroups } from '@/shell/settings/keyboard-groups';
import { searchSettings, shortcutSearchRows, type SearchResult } from '@/shell/settings/search';
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
import { lazyNamed } from '@/ui/lazy';
import { SettingsDialog as Dialog, type SettingsSectionEntry } from '@ruimte/ui/settings/SettingsDialog';
import { formatShortcut } from '@ruimte/ui/shortcut';

// Each pane is a chunk of its own, loaded when it is opened; the search index in `search.ts` never imports one.
const PANES: Record<SettingsSectionId, ComponentType> = {
    appearance: lazyNamed(() => import('@/shell/settings/panes/AppearancePane'), 'AppearancePane'),
    views: lazyNamed(() => import('@/shell/settings/panes/ViewsPane'), 'ViewsPane'),
    files: lazyNamed(() => import('@/shell/settings/panes/FilesPane'), 'FilesPane'),
    providers: lazyNamed(() => import('@/shell/settings/panes/ProvidersPane'), 'ProvidersPane'),
    voice: lazyNamed(() => import('@/shell/settings/panes/VoicePane'), 'VoicePane'),
    computer: lazyNamed(() => import('@/shell/settings/panes/ComputerPane'), 'ComputerPane'),
    usage: lazyNamed(() => import('@/shell/settings/panes/UsagePane'), 'UsagePane'),
    agents: lazyNamed(() => import('@/shell/settings/panes/AgentsPane'), 'AgentsPane'),
    machines: lazyNamed(() => import('@/shell/settings/panes/MachinesPane'), 'MachinesPane'),
    keyboard: lazyNamed(() => import('@/shell/settings/panes/KeyboardPane'), 'KeyboardPane'),
    about: lazyNamed(() => import('@/shell/settings/panes/AboutPane'), 'AboutPane')
};

/* The index plus the shortcuts, whose words and keys are only known once the lists are built. */
const findSettings = (query: string): SearchResult[] => {
    const apple = isApplePlatform();
    return searchSettings(query, query.trim() === '' ? [] : shortcutSearchRows(keyboardGroups(apple), apple));
};

// Built on every render rather than once: the words move with the language, the list does not.
const entryOf = (meta: SettingsSectionMeta): SettingsSectionEntry => ({
    id: meta.id,
    icon: meta.icon,
    label: sectionLabel(meta.id),
    description: sectionDescription(meta.id),
    pane: PANES[meta.id],
    split: meta.split
});

/* Ruimte's sections, search and account in the settings dialog of @ruimte/ui. Opens on the section the caller asked for, or the last one. */
export function SettingsDialog() {
    const open = useUi((s) => s.settings.open);
    const section = useUi((s) => s.settings.section);
    const target = useUi((s) => s.settings.target);
    const searchAt = useUi((s) => s.settings.searchAt);
    const setSettings = useUi((s) => s.setSettings);

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => setSettings({ open: next })}
            section={section}
            onNavigate={({ section: next, target: row }) => setSettings({ section: next as SettingsSectionId, ...(row === undefined ? {} : { target: row }) })}
            groups={SETTINGS_GROUPS.map((group) => ({ label: group.label === null ? null : groupLabel(group.label), sections: group.sections.map(entryOf) }))}
            footer={[entryOf(ABOUT_SECTION)]}
            account={{ section: entryOf(ACCOUNT_SECTION), tab: <AccountTab /> }}
            search={{ find: findSettings, hint: formatShortcut(APP_SHORTCUTS.settingsSearch, isApplePlatform()), focusAt: searchAt }}
            target={target}
            onTargetShown={() => setSettings({ target: null })}
        />
    );
}
