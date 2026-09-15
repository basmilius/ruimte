import { ProjectIconChoiceSchema, type ProjectIconChoice } from '@ruimte/contracts';
import { useServers } from '@/state/server';
import type { MachineEntry } from './machine-list';

/* The icon the machine says it has, or the one the account last heard for a machine never opened here. */
export const useMachineIcon = (entry: MachineEntry): ProjectIconChoice | null => {
    const answered = useServers((s) => (entry.endpoint ? (s.byEndpoint[entry.endpoint.id]?.icon ?? null) : null));
    const recorded = ProjectIconChoiceSchema.safeParse(entry.machine?.icon);
    return answered ?? (recorded.success ? recorded.data : null);
};
