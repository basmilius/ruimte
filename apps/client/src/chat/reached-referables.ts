import type { ProjectReferablesResult } from '@ruimte/contracts';
import { useEffect } from 'react';
import { create } from 'zustand';
import { useServers } from '@/state/server';
import { transportFor } from '@/transport';
import { useMachineAnswers } from '@/transport/features';

type ReachedProjects = ProjectReferablesResult['projects'];

const NONE: ReachedProjects = [];

/* The other open projects of each machine, as far as a `#` may point at them. */
export const useReachedReferables = create<{ byEndpoint: Readonly<Record<string, ReachedProjects>> }>(() => ({ byEndpoint: {} }));

function remember(endpointId: string, projects: ReachedProjects): void {
    useReachedReferables.setState((state) => ({ byEndpoint: { ...state.byEndpoint, [endpointId]: projects } }));
}

/* The other open projects while the machine lets agents reach them, kept current by what it announces of them. */
export function useReachedProjects(endpointId: string): ReachedProjects {
    const reach = useServers((s) => s.byEndpoint[endpointId]?.reachOpenProjects === true);
    const answers = useMachineAnswers(endpointId, 'project.referables');

    useEffect(() => {
        const transport = transportFor(endpointId);

        if (!reach || !answers || !transport) {
            remember(endpointId, NONE);

            return;
        }

        const fetch = (): void => {
            transport
                .request('project.referables', {})
                .then((result) => remember(endpointId, result.projects))
                .catch(() => remember(endpointId, NONE));
        };

        fetch();

        return transport.on('project.summary', fetch);
    }, [endpointId, reach, answers]);

    return useReachedReferables((s) => s.byEndpoint[endpointId] ?? NONE);
}
