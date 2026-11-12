import type { ProjectIconChoice, ProjectSummary } from '@ruimte/contracts';
import { createContext, useContext } from 'react';

/* The project a Project settings dialog is on, and what its panes may change about it. */
export interface ProjectSettingsSubject {
    project: ProjectSummary;
    endpointId: string;
    actions: {
        rename(name: string): Promise<void>;
        setColor(color: string): Promise<void>;
        setChosenIcon(icon: ProjectIconChoice): Promise<void>;
        clearChosenIcon(): Promise<void>;
        uploadIcon(mime: string, base64: string): Promise<void>;
        useFolderIcon(): Promise<void>;
    };
}

export const ProjectSettingsContext = createContext<ProjectSettingsSubject | null>(null);

/* A pane of Project settings draws only inside the dialog, which always has a project. */
export function useProjectSettingsSubject(): ProjectSettingsSubject {
    const subject = useContext(ProjectSettingsContext);

    if (subject === null) {
        throw new Error('A pane of Project settings is drawn outside its dialog');
    }

    return subject;
}
