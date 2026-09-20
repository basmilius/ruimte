import { useProject } from '@/state/project';

let revision = 0;
useProject.subscribe((state, previous) => {
    if (
        state.current?.projectId !== previous.current?.projectId ||
        state.currentEndpointId !== previous.currentEndpointId ||
        (state.switching && !previous.switching)
    ) {
        revision++;
    }
});

export const voiceWorkspaceRevision = (): number => revision;
