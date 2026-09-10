import { useCanvas } from '@/state/canvas';
import { useProject } from '@/state/project';
import { transport } from '@/transport';
import { ProjectClient } from '@/project/project-client';

const actions = useProject.getState();

export const projectClient = new ProjectClient(transport, useCanvas, {
    setProjects: actions.setProjects,
    setCurrent: actions.setCurrent,
    setRev: actions.setRev,
    setChosenIcon: actions.setChosenIcon,
    setSummary: actions.setSummary,
    setDirty: actions.setDirty,
    setConflict: actions.setConflict,
    setError: actions.setError,
    setSwitching: actions.setSwitching,
    getState: () => useProject.getState()
});
