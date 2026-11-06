import { matchesShortcut, isApplePlatform } from '@adecore/ui';
import { behaviorOf, rawCanvasKeyHandlers, rawKeyHandlers, takeKey, type KeyHandler, type KeyPress } from '@/commands/behavior';
import { keyboardOnCanvas } from '@/commands/key-context';
import { commandForKey } from '@/commands/registry';
import { countCommand } from '@/commands/usage';
import { focusedCanvas } from '@/state/canvas';

function pressOf(event: KeyboardEvent, apple: boolean): KeyPress {
    return {
        event,
        apple,
        onCanvas: () => keyboardOnCanvas(event.target, focusedCanvas().getState()),
        is: (shortcut) => matchesShortcut(shortcut, event, apple)
    };
}

/* Answers a key for the window: the rows its listener binds, which work on the start screen too. True when a row took it. */
export function answerWindowKey(event: KeyboardEvent): boolean {
    const apple = isApplePlatform();
    const command = commandForKey('window', event, apple);
    const behavior = command === null ? undefined : behaviorOf(command);
    if (command === null || behavior === undefined) {
        return false;
    }
    const press = pressOf(event, apple);
    const taken = behavior.key !== undefined ? behavior.key(press) : takeKey(press, () => behavior.run());
    if (taken) {
        countCommand(command, 'shortcut');
    }

    return taken;
}

/* Answers a key for the workspace: the row it binds, then the keys that belong to no row. */
export function answerWorkspaceKey(event: KeyboardEvent): void {
    const apple = isApplePlatform();
    const command = commandForKey('workspace', event, apple);
    const press = pressOf(event, apple);
    const behavior = command === null ? undefined : behaviorOf(command);
    const onCanvasOnly = behavior?.keyTier === 'canvas';
    const steps: KeyHandler[] = [
        ...(onCanvasOnly || behavior?.key === undefined ? [] : [behavior.key.bind(behavior)]),
        ...rawKeyHandlers(),
        ...(onCanvasOnly && behavior?.key !== undefined ? [behavior.key.bind(behavior)] : []),
        ...rawCanvasKeyHandlers()
    ];
    steps.some((step) => step(press));
    // A key counts once something acted on it; one that was let go is whatever has the focus's.
    if (command !== null && event.defaultPrevented) {
        countCommand(command, 'shortcut');
    }
}

/* The capture phase of the workspace listener: a row may take a key before any other listener hears it. */
export function answerWorkspaceKeyEarly(event: KeyboardEvent): boolean {
    const apple = isApplePlatform();
    const command = commandForKey('workspace', event, apple);
    const behavior = command === null ? undefined : behaviorOf(command);
    if (behavior?.captureKey === undefined) {
        return false;
    }
    const taken = behavior.captureKey(pressOf(event, apple));
    if (taken) {
        event.preventDefault();
        event.stopPropagation();
    }

    return taken;
}

/* Runs a row for a button that offers the same thing as its key. */
export function runCommand(id: string): void {
    behaviorOf(id)?.run();
}
