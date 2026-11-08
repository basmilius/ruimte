import { PROVIDERS_SECTION, USAGE_SECTION, type AgentsSettingsSection } from '@adecore/agents-react';
import i18next from 'i18next';
import {
    Bot,
    Cable,
    CodeXml,
    Folder,
    Info,
    Keyboard,
    LayoutGrid,
    MessagesSquare,
    Mic,
    Palette,
    Puzzle,
    Server,
    Settings,
    SquareTerminal,
    type LucideIcon
} from 'lucide-react';
import { useContributions, type SettingsSectionContribution } from '@/extensions/registry';
import type { SettingsSectionId } from '@/state/ui';

export interface SettingsSectionMeta {
    id: SettingsSectionId;
    icon: LucideIcon;
    /* A list beside a detail that scrolls on its own, instead of one column of sections (`MasterDetail`). */
    split?: boolean;
}

interface SettingsNavGroup {
    /* The words under `nav.groups.<label>`; the first group goes without a label. */
    label: 'workspace' | 'ai' | null;
    sections: readonly SettingsSectionMeta[];
}

/*
 * The left navigation: what the whole app does and how it looks, the surfaces you work in, and the
 * agents with how their chats read, what they may do and what they cost. The pane for each id lives in
 * `panes/`, and its words under `sections.<id>` in the settings namespace.
 */
export const SETTINGS_GROUPS: readonly SettingsNavGroup[] = [
    {
        label: null,
        sections: [
            { id: 'general', icon: Settings },
            { id: 'appearance', icon: Palette },
            { id: 'keyboard', icon: Keyboard, split: true }
        ]
    },
    {
        label: 'workspace',
        sections: [
            { id: 'views', icon: LayoutGrid },
            { id: 'editor', icon: CodeXml },
            { id: 'terminal', icon: SquareTerminal },
            { id: 'files', icon: Folder },
            { id: 'extensions', icon: Puzzle, split: true }
        ]
    },
    {
        label: 'ai',
        sections: [
            { id: 'providers', icon: PROVIDERS_SECTION.icon, split: PROVIDERS_SECTION.split },
            { id: 'chats', icon: MessagesSquare },
            { id: 'agents', icon: Bot },
            { id: 'tunnels', icon: Cable },
            { id: 'voice', icon: Mic },
            { id: 'usage', icon: USAGE_SECTION.icon }
        ]
    }
];

/* At the foot of the navigation, under the groups: the app itself, then the account block. */
export const ABOUT_SECTION: SettingsSectionMeta = { id: 'about', icon: Info };
export const ACCOUNT_SECTION: SettingsSectionMeta = { id: 'machines', icon: Server, split: true };

/* The groups with the sections built-ins bring, each behind the core section it names. */
export function settingsGroupsWith(contributed: readonly SettingsSectionContribution[]): readonly SettingsNavGroup[] {
    return SETTINGS_GROUPS.map((group) => {
        if (group.label === null) {
            return group;
        }

        const own = contributed.filter((section) => section.group === group.label);

        return {
            ...group,
            sections: group.sections.flatMap((section) => [section, ...own.filter((entry) => entry.after === section.id).map(({ id, icon }) => ({ id, icon }))])
        };
    });
}

export function allSettingsSections(): readonly SettingsSectionMeta[] {
    const contributed = useContributions.getState().settingsSections;

    return [...settingsGroupsWith(contributed).flatMap((group) => group.sections), ABOUT_SECTION, ACCOUNT_SECTION];
}

/* The sections the chat's package brings, which carry their own words. */
const AGENTS_SECTIONS: Partial<Record<SettingsSectionId, AgentsSettingsSection>> = { providers: PROVIDERS_SECTION, usage: USAGE_SECTION };

function contributedSection(id: SettingsSectionId): SettingsSectionContribution | undefined {
    return useContributions.getState().settingsSections.find((section) => section.id === id);
}

/* Read when a section is drawn, never at module level. The translations are not in yet while this file loads. */
export function sectionLabel(id: SettingsSectionId): string {
    const contributed = contributedSection(id);

    if (contributed !== undefined) {
        return i18next.t(contributed.labelKey);
    }

    return AGENTS_SECTIONS[id]?.label() ?? i18next.t(`settings:sections.${id}.label`);
}

/* One line under the pane title that says what the pane is about. */
export function sectionDescription(id: SettingsSectionId): string {
    const contributed = contributedSection(id);

    if (contributed !== undefined) {
        return i18next.t(contributed.descriptionKey);
    }

    return AGENTS_SECTIONS[id]?.description() ?? i18next.t(`settings:sections.${id}.description`);
}

export function groupLabel(label: NonNullable<SettingsNavGroup['label']>): string {
    return i18next.t(`settings:nav.groups.${label}`);
}
