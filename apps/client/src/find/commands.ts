import { defineBehaviors, type CommandBehavior } from '@/commands/behavior';
import { keyFree } from '@/commands/key-context';
import { openFocusedFind } from '@/find/hosts';
import { stepFocusedEditorFind } from '@/find/use-editor-find';
import { languageForCommand } from '@/language/focused-language';

function finding(options?: { replace: true }): CommandBehavior {
    return {
        run: () => void openFocusedFind(options),
        offered: (moment) => moment.inWorkspace,
        afterClose: true,
        // A surface with nothing to search lets the key go, so a browser tab still gets its own find.
        key: (press) => {
            if (keyFree(press.event.target) && openFocusedFind(options)) {
                press.event.preventDefault();
            }

            return true;
        }
    };
}

function onLanguage(run: () => void): CommandBehavior {
    return { run, offered: (moment) => moment.inWorkspace, afterClose: true };
}

export const FIND_BEHAVIORS = defineBehaviors({
    find: finding(),
    'find-replace': finding({ replace: true }),
    'find-next': onLanguage(() => void stepFocusedEditorFind(1)),
    'find-previous': onLanguage(() => void stepFocusedEditorFind(-1)),
    'next-problem': onLanguage(() => languageForCommand()?.diagnostics.step(1)),
    'previous-problem': onLanguage(() => languageForCommand()?.diagnostics.step(-1)),
    'next-highlight': onLanguage(() => languageForCommand()?.highlights.step(1)),
    'previous-highlight': onLanguage(() => languageForCommand()?.highlights.step(-1))
});
