import i18next from 'i18next';
import { settingsSectionRegistry, type SettingsSectionDefinition, type SettingsSlot } from '@/registry/settings-sections';
import { useContributions, type SettingsSectionContribution } from '@/state/extension-registry';
import type { SettingsSectionId } from '@/state/ui';

export interface SettingsSectionMeta {
    id: SettingsSectionId;
    icon: SettingsSectionDefinition['icon'];
    /* A list beside a detail that scrolls on its own, instead of one column of sections (`MasterDetail`). */
    split?: boolean;
}

interface SettingsNavGroup {
    /* The words under `nav.groups.<label>`; the first group goes without a label. */
    label: 'workspace' | 'ai' | null;
    sections: readonly SettingsSectionMeta[];
}

const NAV_GROUPS: readonly { slot: SettingsSlot; label: SettingsNavGroup['label'] }[] = [
    { slot: 'general', label: null },
    { slot: 'workspace', label: 'workspace' },
    { slot: 'ai', label: 'ai' }
];

function metaOf(definition: SettingsSectionDefinition): SettingsSectionMeta {
    return { id: definition.id, icon: definition.icon, ...(definition.split === undefined ? {} : { split: definition.split }) };
}

function inSlot(slot: SettingsSlot): SettingsSectionMeta[] {
    return settingsSectionRegistry
        .all()
        .filter((definition) => definition.slot === slot && definition.tabOf === undefined)
        .map(metaOf);
}

/* The section the navigation shows for one: the section a tab section is drawn in, or the section itself. */
export function navSectionOf(id: SettingsSectionId): SettingsSectionId {
    return settingsSectionRegistry.find(id)?.tabOf ?? id;
}

/* The tabs of a section in the navigation, its own pane first; none for a section without tab sections. */
export function tabSectionsOf(id: SettingsSectionId): readonly SettingsSectionDefinition[] {
    const own = settingsSectionRegistry.find(id);
    const tabs = settingsSectionRegistry.all().filter((definition) => definition.tabOf === id);

    return own === undefined || tabs.length === 0 ? [] : [own, ...tabs];
}

/* The section whose pane draws a row, so a search result opens the tab that holds it. */
export function sectionOfRow(rowId: string): SettingsSectionId | null {
    return settingsSectionRegistry.all().find((definition) => definition.rows.some((row) => row.id === rowId))?.id ?? null;
}

export function aboutSection(): SettingsSectionMeta {
    return inSlot('footer')[0]!;
}

export function accountSection(): SettingsSectionMeta {
    return inSlot('account')[0]!;
}

export function settingsGroupsWith(contributed: readonly SettingsSectionContribution[]): readonly SettingsNavGroup[] {
    return NAV_GROUPS.map(({ slot, label }) => {
        const sections = inSlot(slot);
        if (label === null) {
            return { label, sections };
        }
        const own = contributed.filter((section) => section.group === label);
        const placed = (entry: SettingsSectionContribution): SettingsSectionMeta => ({ id: entry.id, icon: entry.icon });
        // One that follows no section of this group stands at its end.
        const last = own.filter((entry) => !sections.some((section) => section.id === entry.after));

        return {
            label,
            sections: [...sections.flatMap((section) => [section, ...own.filter((entry) => entry.after === section.id).map(placed)]), ...last.map(placed)]
        };
    });
}

/* Every section, a tab section right after the section it is drawn in. */
export function allSettingsSections(): readonly SettingsSectionMeta[] {
    const contributed = useContributions.getState().settingsSections;
    const inNavigation = [...settingsGroupsWith(contributed).flatMap((group) => group.sections), aboutSection(), accountSection()];

    return inNavigation.flatMap((meta) => [meta, ...tabSectionsOf(meta.id).slice(1).map(metaOf)]);
}

function contributedSection(id: SettingsSectionId): SettingsSectionContribution | undefined {
    return useContributions.getState().settingsSections.find((section) => section.id === id);
}

/* Read when a section is drawn, never at module level. The translations are not in yet while this file loads. */
export function sectionLabel(id: SettingsSectionId): string {
    const contributed = contributedSection(id);
    if (contributed !== undefined) {
        return i18next.t(contributed.labelKey);
    }

    return settingsSectionRegistry.find(id)?.label() ?? i18next.t(`settings:sections.${id}.label`);
}

export function sectionDescription(id: SettingsSectionId): string {
    const contributed = contributedSection(id);
    if (contributed !== undefined) {
        return i18next.t(contributed.descriptionKey);
    }

    return settingsSectionRegistry.find(id)?.description() ?? i18next.t(`settings:sections.${id}.description`);
}

export function groupLabel(label: NonNullable<SettingsNavGroup['label']>): string {
    return i18next.t(`settings:nav.groups.${label}`);
}
