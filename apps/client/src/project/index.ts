import { useCanvas } from '@/state/canvas';
import { useProject } from '@/state/project';
import { transport } from '@/transport';
import { ProjectClient } from '@/project/project-client';

const actions = useProject.getState();

export const projectClient = new ProjectClient(transport, useCanvas, {
    setProjects: actions.setProjects,
    setCurrent: actions.setCurrent,
    setRev: actions.setRev,
    setDirty: actions.setDirty,
    setConflict: actions.setConflict,
    setError: actions.setError,
    getState: () => useProject.getState()
});
