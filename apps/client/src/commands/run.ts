import { behaviorOf, runBehavior } from '@/commands/behavior';
import { generatedOf } from '@/commands/generated';
import { CommandMoment } from '@/commands/moment';
import { commandRows } from '@/commands/palette-rows';
import { commandSpec, isCommandId } from '@/commands/registry';
import { countCommand } from '@/commands/usage';

/* A row the palette runs: one of the table's it has, or one a feature makes per thing it holds. */
export function isPaletteId(id: string): boolean {
    return (isCommandId(id) && commandSpec(id).palette) || generatedOf(id)?.palette === true;
}

/* A click in the application menu. The palette's rows run through the same behaviors, so both do the same thing. */
export function runMenuCommand(id: string): void {
    countCommand(id, 'menu');
    const behavior = behaviorOf(id);
    if (behavior !== undefined) {
        // A row the palette has runs after the click has finished closing the menu, which hands the focus back to where it was.
        // It runs only while the palette would offer it, since a menu built before the last change may still show it.
        if (commandSpec(id).palette) {
            setTimeout(() => {
                if ((behavior.offered?.(new CommandMoment()) ?? true) !== false) {
                    runBehavior(id);
                }
            });
        } else {
            runBehavior(id);
        }

        return;
    }
    const kind = generatedOf(id);
    if (kind?.run !== undefined) {
        kind.run(id.slice(kind.prefix.length));

        return;
    }
    if (isPaletteId(id)) {
        // The same, for the rows of the language and the editor.
        setTimeout(() => {
            commandRows()
                .find((command) => command.id === id)
                ?.run();
        });
    }
}
