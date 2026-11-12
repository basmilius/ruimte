import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import { createRegistry } from './create-registry';

/* What a section may ask about the project the dialog is on before it shows. */
export interface ProjectSettingsFacts {
    /* The machine's Chats project, whose name and folder are not a person's to set. */
    readonly scratch: boolean;
    /* Whether it is the project this window holds, which is the only one whose document a pane can read. */
    readonly onScreen: boolean;
}

export interface ProjectSettingsRow {
    /* The `searchId` of the row in its pane. */
    readonly id: string;
    /* Read when the search runs, never at module level: the translations are not in yet while this file loads. */
    readonly label: () => string;
}

/* A section of Project settings: its pane reads the project through `useProjectSettingsSubject`. */
export interface ProjectSettingsSectionDefinition {
    readonly id: string;
    readonly icon: LucideIcon;
    readonly label: () => string;
    readonly description: () => string;
    readonly pane: ComponentType;
    readonly rows: readonly ProjectSettingsRow[];
    readonly available?: (facts: ProjectSettingsFacts) => boolean;
}

export const projectSettingsSectionRegistry = createRegistry<ProjectSettingsSectionDefinition>('project settings section');
