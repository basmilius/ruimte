import { USAGE_DESKTOP_COMMANDS, type UsageCommandSource, type UsageDesktopCommand, type UsageDesktopCounter } from '@ruimte/pulsar';
import { generatedOf } from '@/commands/generated';
import { isCommandId } from '@/commands/registry';
import { desktop } from '@/desktop/bridge';

/*
 * What the desktop app counts for its own usage report that no machine sees: the commands a person
 * gives and where from. The shell keeps the counts, drops a name it does not know and counts nothing while
 * the machine's switch is off; outside it nothing is sent.
 */
const COMMAND_NAMES: ReadonlySet<string> = new Set(USAGE_DESKTOP_COMMANDS);

/* The counted name of a command row, or null for an id that is no row of the table or of a generated kind. */
export function commandUsageName(id: string): UsageDesktopCommand | null {
    if (isCommandId(id)) {
        const name = id.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());

        return COMMAND_NAMES.has(name) ? (name as UsageDesktopCommand) : null;
    }

    return generatedOf(id)?.usage ?? null;
}

export function countDesktopUsage(name: UsageDesktopCounter): void {
    desktop()?.countUsage?.(name);
}

export function countCommand(id: string, source: UsageCommandSource): void {
    const name = commandUsageName(id);
    if (name !== null) {
        countDesktopUsage(`commands.${source}.${name}`);
    }
}
