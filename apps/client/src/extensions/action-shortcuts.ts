import { shortcutProblem } from '@ruimte/contracts';
import { runAction } from '@/extensions/action-runs';
import { useContributions, type SlotEntry } from '@/extensions/registry';
import { baseContext, nodeInfoOf } from '@/extensions/slots';
import { focusedCanvas } from '@/state/canvas';

const MODIFIERS = new Set(['mod', 'shift', 'alt']);

/* Refuses what the rule of every shortcut refuses: a key on its own. */
export function assertShortcut(shortcut: string): void {
    const problem = shortcutProblem(shortcut);

    if (problem !== null) {
        throw new Error(problem);
    }
}

export function matchesExtensionShortcut(
    shortcut: string,
    event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
    apple: boolean
): boolean {
    const parts = shortcut.toLowerCase().split('+');
    const key = parts.find((part) => !MODIFIERS.has(part));

    return (
        key === event.key.toLowerCase() &&
        parts.includes('mod') === (apple ? event.metaKey : event.ctrlKey) &&
        parts.includes('shift') === event.shiftKey &&
        parts.includes('alt') === event.altKey
    );
}

/* Asked by the app's one listener, so a key an extension took is that listener's to swallow. */
export function runActionShortcut(event: KeyboardEvent, apple: boolean): boolean {
    const entry = useContributions
        .getState()
        .slotEntries.find((each: SlotEntry) => each.shortcut !== undefined && matchesExtensionShortcut(each.shortcut, event, apple));

    if (entry === undefined) {
        return false;
    }

    event.preventDefault();
    void runAction(entry, { ...baseContext(), nodes: focusedCanvas().getState().selection.map(nodeInfoOf) }, 'shortcut');

    return true;
}
