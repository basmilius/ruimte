import i18next from 'i18next';
import { Bot, Brain, ChartNoAxesColumn, Folder, Info, Keyboard, Mic, MousePointer2, Palette, PanelsTopLeft, Server, type LucideIcon } from 'lucide-react';
import type { SettingsSectionId } from '@/state/ui';

export interface SettingsSectionMeta {
    id: SettingsSectionId;
    icon: LucideIcon;
    /* A list beside a detail that scrolls on its own, instead of one column of sections (`MasterDetail`). */
    split?: boolean;
}

export interface SettingsNavGroup {
    /* The words under `nav.groups.<label>`; the first group goes without a label. */
    label: 'workspace' | 'ai' | null;
    sections: readonly SettingsSectionMeta[];
}

/*
 * The left navigation: how the app looks and answers, the surfaces you work in, and the agents with
 * what they may operate and what they cost. The pane for each id lives in `panes/`, and its words
 * under `sections.<id>` in the settings namespace.
 */
export const SETTINGS_GROUPS: readonly SettingsNavGroup[] = [
    {
        label: null,
        sections: [
            { id: 'appearance', icon: Palette },
            { id: 'keyboard', icon: Keyboard, split: true }
        ]
    },
    {
        label: 'workspace',
        sections: [
            { id: 'views', icon: PanelsTopLeft },
            { id: 'files', icon: Folder }
        ]
    },
    {
        label: 'ai',
        sections: [
            { id: 'providers', icon: Brain, split: true },
            { id: 'agents', icon: Bot },
            { id: 'computer', icon: MousePointer2 },
            { id: 'usage', icon: ChartNoAxesColumn },
            { id: 'voice', icon: Mic }
        ]
    }
];

/* At the foot of the navigation, under the groups: the app itself, then the account block. */
export const ABOUT_SECTION: SettingsSectionMeta = { id: 'about', icon: Info };
export const ACCOUNT_SECTION: SettingsSectionMeta = { id: 'machines', icon: Server, split: true };

export const ALL_SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [...SETTINGS_GROUPS.flatMap((group) => group.sections), ABOUT_SECTION, ACCOUNT_SECTION];

/* Read when a section is drawn, never at module level. The translations are not in yet while this file loads. */
export const sectionLabel = (id: SettingsSectionId): string => i18next.t(`settings:sections.${id}.label`);

/* One line under the pane title that says what the pane is about. */
export const sectionDescription = (id: SettingsSectionId): string => i18next.t(`settings:sections.${id}.description`);

export const groupLabel = (label: NonNullable<SettingsNavGroup['label']>): string => i18next.t(`settings:nav.groups.${label}`);
