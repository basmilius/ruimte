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
        .filter((definition) => definition.slot === slot)
        .map(metaOf);
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

export function allSettingsSections(): readonly SettingsSectionMeta[] {
    const contributed = useContributions.getState().settingsSections;

    return [...settingsGroupsWith(contributed).flatMap((group) => group.sections), aboutSection(), accountSection()];
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
