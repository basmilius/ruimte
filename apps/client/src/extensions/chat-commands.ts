import { useMachineComposer } from '@/extensions/machine-composer';
import { useContributions } from '@/state/extension-registry';

/*
 * The commands of extensions after `/`: those of `client/`, then what `server/` adds under a name no client command has.
 * Apart from `chat-seams.tsx`, which the start screen loads: only a workspace has a composer, and asking the machine
 * belongs to it.
 */
export function useExpandingCommands() {
    const machine = useMachineComposer();
    const fromClient = useContributions((state) => state.slashCommands).map((command) => ({
        name: command.name,
        hint: command.description,
        expand: command.expand
    }));
    const taken = new Set(fromClient.map((command) => command.name));
    const fromMachine = machine.commands
        // Also one name between two extensions: the composer runs a command by its name, so the first keeps it.
        .filter((command) => !taken.has(command.name) && taken.add(command.name) !== undefined)
        .map((command) => ({ name: command.name, hint: command.description, expand: (args: string) => machine.expand(command, args) }));

    return [...fromClient, ...fromMachine];
}
