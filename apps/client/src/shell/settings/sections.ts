import { faCircleInfo, faGrid2, faKeyboard, faPalette, faRobot, faServer } from '@fortawesome/pro-regular-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { SettingsSectionId } from '@/state/ui';

export interface SettingsSectionMeta {
    id: SettingsSectionId;
    label: string;
    /* One line under the pane title that says what the pane is about. */
    description: string;
    icon: IconDefinition;
}

/* The order of the left navigation; the pane for each id lives in `panes/`. */
export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
    { id: 'appearance', label: 'Appearance', description: 'Theme, accent and the terminal font.', icon: faPalette },
    { id: 'canvas', label: 'Canvas', description: 'Zoom presets and locks for the canvas you are looking at.', icon: faGrid2 },
    { id: 'agents', label: 'Agents', description: 'What a new agent starts with, and which CLIs the daemon found.', icon: faRobot },
    { id: 'machines', label: 'Machines', description: 'The daemons this client can talk to.', icon: faServer },
    { id: 'keyboard', label: 'Keyboard', description: 'Every shortcut. Remapping comes later.', icon: faKeyboard },
    { id: 'about', label: 'About', description: 'Version, the machine you are connected to, and where to find more.', icon: faCircleInfo }
];
