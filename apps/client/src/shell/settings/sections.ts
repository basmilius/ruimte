import {
    ArrowDownToLine,
    Bot,
    ChartNoAxesColumn,
    Folder,
    GitBranch,
    Info,
    Keyboard,
    LayoutGrid,
    Palette,
    PenTool,
    Server,
    type LucideIcon
} from 'lucide-react';
import type { SettingsSectionId } from '@/state/ui';

interface SettingsSectionMeta {
    id: SettingsSectionId;
    label: string;
    /* One line under the pane title that says what the pane is about. */
    description: string;
    icon: LucideIcon;
}

/* The order of the left navigation; the pane for each id lives in `panes/`. */
export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
    { id: 'appearance', label: 'Appearance', description: 'Theme, accent and the terminal font.', icon: Palette },
    { id: 'canvas', label: 'Canvas', description: 'Zoom presets and locks for the canvas you are looking at.', icon: LayoutGrid },
    { id: 'drawing', label: 'Drawing', description: 'How a drawing view behaves while you draw.', icon: PenTool },
    { id: 'files', label: 'Files', description: 'What the Files panel shows, and where browsing for a folder starts.', icon: Folder },
    { id: 'git', label: 'Git', description: 'How the Git panel lists what changed.', icon: GitBranch },
    { id: 'usage', label: 'Usage', description: 'The money the usage page counts in.', icon: ChartNoAxesColumn },
    { id: 'agents', label: 'Agents', description: 'What a new agent starts with, and which CLIs the machine found.', icon: Bot },
    { id: 'machines', label: 'Machines', description: 'The machines this client can talk to, and what each one is called.', icon: Server },
    { id: 'keyboard', label: 'Keyboard', description: 'Every shortcut. Remapping comes later.', icon: Keyboard },
    { id: 'updates', label: 'Updates', description: 'The version you run, and what the app does when there is a newer one.', icon: ArrowDownToLine },
    { id: 'about', label: 'About', description: 'Version, the machine you are connected to, and where to find more.', icon: Info }
];
