import { Bot, ChartNoAxesColumn, Folder, Info, Keyboard, LayoutGrid, Palette, Server, type LucideIcon } from 'lucide-react';
import type { SettingsSectionId } from '@/state/ui';

export interface SettingsSectionMeta {
    id: SettingsSectionId;
    label: string;
    /* One line under the pane title that says what the pane is about. */
    description: string;
    icon: LucideIcon;
}

/*
 * The left navigation, in groups with a separator between them: how the app looks and answers, the
 * surfaces you work in, the agents and what they cost, the machines, and the app itself. The pane
 * for each id lives in `panes/`.
 */
export const SETTINGS_SECTIONS: readonly (readonly SettingsSectionMeta[])[] = [
    [
        { id: 'appearance', label: 'Appearance', description: 'Theme, accent and the terminal font.', icon: Palette },
        { id: 'keyboard', label: 'Keyboard', description: 'Every keyboard shortcut.', icon: Keyboard }
    ],
    [
        { id: 'canvas', label: 'Canvas', description: 'How canvases and drawings behave.', icon: LayoutGrid },
        { id: 'files', label: 'Files and Git', description: 'What the Files and Git panels show, and where browsing for a folder starts.', icon: Folder }
    ],
    [
        { id: 'agents', label: 'Agents', description: 'Defaults, permissions and notifications for agents.', icon: Bot },
        { id: 'usage', label: 'Usage', description: 'The currency of the usage page.', icon: ChartNoAxesColumn }
    ],
    [{ id: 'machines', label: 'Machines', description: 'Pair, name and forget machines.', icon: Server }],
    [{ id: 'about', label: 'About', description: 'Version, machine details and links.', icon: Info }]
];

export const ALL_SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = SETTINGS_SECTIONS.flat();
