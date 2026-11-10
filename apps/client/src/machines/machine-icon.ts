import { ProjectIconChoiceSchema, type ProjectIconChoice } from '@ruimte/contracts';
import { useServers } from '@/state/server';
import type { MachineEntry } from './machine-list';

export function iconOfEntry(entry: MachineEntry, answered: ProjectIconChoice | null): ProjectIconChoice | null {
    if (answered !== null) {
        return answered;
    }
    const recorded = ProjectIconChoiceSchema.safeParse(entry.machine?.icon);
    return recorded.success ? recorded.data : null;
}

export function useMachineIcon(entry: MachineEntry): ProjectIconChoice | null {
    const answered = useServers((s) => (entry.endpoint ? (s.byEndpoint[entry.endpoint.id]?.icon ?? null) : null));
    return iconOfEntry(entry, answered);
}
