import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { isApplePlatform } from '@/desktop/bridge';
import { AccountTab } from '@/shell/settings/AccountTab';
import { findSettings } from '@/shell/settings/find-settings';
import { useContributions, type SettingsSectionContribution } from '@/extensions/registry';
import {
    ABOUT_SECTION,
    ACCOUNT_SECTION,
    groupLabel,
    sectionDescription,
    sectionLabel,
    settingsGroupsWith,
    type SettingsSectionMeta
} from '@/shell/settings/sections';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { useUi, type CoreSettingsSectionId, type SettingsSectionId } from '@/state/ui';
import { SettingsDialog as Dialog, type SettingsSectionEntry } from '@adecore/ui/settings';
import { formatShortcut, lazyNamed } from '@adecore/ui';

// Each pane is a chunk of its own, loaded when it is opened; the search index in `search.ts` never imports one.
const PANES: Record<CoreSettingsSectionId, ComponentType> = {
    general: lazyNamed(() => import('@/shell/settings/panes/GeneralPane'), 'GeneralPane'),
    appearance: lazyNamed(() => import('@/shell/settings/panes/AppearancePane'), 'AppearancePane'),
    editor: lazyNamed(() => import('@/shell/settings/panes/EditorPane'), 'EditorPane'),
    terminal: lazyNamed(() => import('@/shell/settings/panes/TerminalPane'), 'TerminalPane'),
    views: lazyNamed(() => import('@/shell/settings/panes/ViewsPane'), 'ViewsPane'),
    files: lazyNamed(() => import('@/shell/settings/panes/FilesPane'), 'FilesPane'),
    providers: lazyNamed(() => import('@/shell/settings/panes/ProvidersPane'), 'ProvidersPane'),
    chats: lazyNamed(() => import('@/shell/settings/panes/ChatsPane'), 'ChatsPane'),
    voice: lazyNamed(() => import('@/shell/settings/panes/VoicePane'), 'VoicePane'),
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
function entryOf(meta: SettingsSectionMeta, contributed: readonly SettingsSectionContribution[]): SettingsSectionEntry {
    return {
        id: meta.id,
        icon: meta.icon,
        label: sectionLabel(meta.id),
        description: sectionDescription(meta.id),
        pane: contributed.find((section) => section.id === meta.id)?.component ?? PANES[meta.id as CoreSettingsSectionId],
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
    const contributed = useContributions((state) => state.settingsSections);
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
            footer={[entryOf(ABOUT_SECTION, contributed)]}
            account={{ section: entryOf(ACCOUNT_SECTION, contributed), tab: <AccountTab /> }}
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
