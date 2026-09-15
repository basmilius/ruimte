import { ProjectIconChoiceSchema, type ProjectIconChoice } from '@ruimte/contracts';
import { useServers } from '@/state/server';
import type { MachineEntry } from './machine-list';

/* The icon the machine answered with, else the one the account last heard, for a list that draws many. */
export const iconOfEntry = (entry: MachineEntry, answered: ProjectIconChoice | null): ProjectIconChoice | null => {
    if (answered !== null) {
        return answered;
    }
    const recorded = ProjectIconChoiceSchema.safeParse(entry.machine?.icon);
    return recorded.success ? recorded.data : null;
};

/* The icon the machine says it has, or the one the account last heard for a machine never opened here. */
export const useMachineIcon = (entry: MachineEntry): ProjectIconChoice | null => {
    const answered = useServers((s) => (entry.endpoint ? (s.byEndpoint[entry.endpoint.id]?.icon ?? null) : null));
    return iconOfEntry(entry, answered);
};
