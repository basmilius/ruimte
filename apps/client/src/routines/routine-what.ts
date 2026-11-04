import { runtimeModeLabel } from '@adecore/agents-react/chat';
import { useProviders } from '@adecore/agents-react/state';
import type { RoutineEntry } from '@ruimte/contracts';

/* What a routine runs, in one line: the agent, its model and mode, the command, or the launch. A row of the week leaves the mode out. */
export function useRoutineWhat(entry: RoutineEntry, withMode = true): string {
    const providers = useProviders((s) => s.providers);
    const routine = entry.routine;
    if (routine.kind === 'command') {
        return routine.command;
    }
    if (routine.kind === 'launch') {
        return routine.launchId;
    }
    const provider = providers.find((candidate) => candidate.kind === routine.provider);
    const model =
        routine.selection === undefined
            ? null
            : (provider?.models.find((candidate) => candidate.slug === routine.selection?.model)?.name ?? routine.selection.model);
    return [provider?.name ?? routine.provider, model, withMode ? runtimeModeLabel(routine.mode) : null].filter((part) => part !== null).join(' · ');
}
