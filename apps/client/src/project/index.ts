import { useCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useDrawing } from '@/state/drawing';
import { useProject } from '@/state/project';
import { transport } from '@/transport';
import { DrawingClient } from '@/drawing/drawing-client';
import { PanelsPort } from '@/project/panels-port';
import { ProjectClient } from '@/project/project-client';

const actions = useProject.getState();

export const panelsPort = new PanelsPort();

/*
 * The drawing client is built first: the project client hands it the moment before a project is
 * swapped in, so the drawing on screen reaches its own file while the old project is still open.
 */
export const drawingClient: DrawingClient = new DrawingClient(transport, useDrawing, useDocument, useProject, {
    flushProject: (): Promise<void> => projectClient.flush()
});

export const projectClient: ProjectClient = new ProjectClient(
    transport,
    useCanvas,
    useDocument,
    panelsPort,
    {
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
    },
    {
        drawing: useDrawing,
        beforeSwitch: (): Promise<void> => drawingClient.flush()
    }
);
