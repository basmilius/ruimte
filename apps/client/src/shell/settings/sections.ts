import i18next from 'i18next';
import { Bot, ChartNoAxesColumn, Folder, Info, Keyboard, Mic, MousePointer2, Palette, PanelsTopLeft, Server, type LucideIcon } from 'lucide-react';
import type { SettingsSectionId } from '@/state/ui';

export interface SettingsSectionMeta {
    id: SettingsSectionId;
    icon: LucideIcon;
}

/*
 * The left navigation, in groups with a separator between them: how the app looks and answers, the
 * surfaces you work in, the agents, what they cost and what they may operate, the machines, and the app itself. The pane
 * for each id lives in `panes/`, and its words under `sections.<id>` in the settings namespace.
 */
export const SETTINGS_SECTIONS: readonly (readonly SettingsSectionMeta[])[] = [
    [
        { id: 'appearance', icon: Palette },
        { id: 'keyboard', icon: Keyboard }
    ],
    [
        { id: 'views', icon: PanelsTopLeft },
        { id: 'files', icon: Folder }
    ],
    [
        { id: 'agents', icon: Bot },
        { id: 'usage', icon: ChartNoAxesColumn },
        { id: 'voice', icon: Mic },
        { id: 'computer', icon: MousePointer2 }
    ],
    [{ id: 'machines', icon: Server }],
    [{ id: 'about', icon: Info }]
];

export const ALL_SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = SETTINGS_SECTIONS.flat();

/* Read when a section is drawn, never at module level. The translations are not in yet while this file loads. */
export const sectionLabel = (id: SettingsSectionId): string => i18next.t(`settings:sections.${id}.label`);

/* One line under the pane title that says what the pane is about. */
export const sectionDescription = (id: SettingsSectionId): string => i18next.t(`settings:sections.${id}.description`);
