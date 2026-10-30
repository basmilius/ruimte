import { create } from 'zustand';
import { endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';

export const useAttentionQueue = create<{ projectKey: string | null }>(() => ({ projectKey: null }));

export function openAttentionQueue(): void {
    const { current, currentEndpointId } = useProject.getState();

    if (current !== null && currentEndpointId !== null) {
        useAttentionQueue.setState({ projectKey: endpointKey(currentEndpointId, current.projectId) });
    }
}

export function closeAttentionQueue(): void {
    useAttentionQueue.setState({ projectKey: null });
}
