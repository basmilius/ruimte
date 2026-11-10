import type { UsageDesktopCommand } from '@ruimte/pulsar';
import type { LucideIcon } from 'lucide-react';

/*
 * A row made once per view, launch, agent, layout or recent project. It is counted under one name and
 * never by its own id, and the table of ids has no row for it.
 */
export interface GeneratedCommands {
    readonly prefix: string;
    /* The name its uses are counted under (`USAGE_DESKTOP_COMMANDS`). */
    readonly usage: UsageDesktopCommand;
    /* The palette runs rows of this prefix (`palette/`); the menu's own ones are run by `run` alone. */
    readonly palette: boolean;
    /* Runs the row the menu clicked; the palette's rows carry their own handler. */
    run?(rest: string): void;
    readonly icon?: LucideIcon;
}

const generated: GeneratedCommands[] = [];

export function registerGenerated(...kinds: readonly GeneratedCommands[]): void {
    for (const kind of kinds) {
        if (generated.some((existing) => existing.prefix === kind.prefix)) {
            throw new Error(`The command prefix "${kind.prefix}" is registered twice.`);
        }
        generated.push(kind);
    }
}

export function generatedOf(id: string): GeneratedCommands | undefined {
    return generated.find((kind) => id.startsWith(kind.prefix));
}

export function generatedKinds(): readonly GeneratedCommands[] {
    return generated;
}
