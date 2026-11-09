import type { Shortcut } from '@adecore/ui';
import type { AgentKind } from '@ruimte/contracts';
import type { CommandMoment } from '@/commands/moment';

/* How the palette words a row now, in place of the words of the table. */
export interface PaletteOptions {
    hint?: string;
    label?: string;
    values?: Record<string, string>;
    /* The key the row shows when it is not the table's, or null for none. */
    shortcut?: Shortcut | null;
}

export interface Command {
    id: string;
    label: string;
    hint?: string;
    /* Shown next to the label; the handler binds the same value. */
    shortcut?: Shortcut;
    /* Draws this row with the CLI's brand mark instead of the generic action icon. */
    agent?: AgentKind;
    run(): void;
}

/* One key press on the workspace, with what a handler needs to decide whether the key is its own. */
export interface KeyPress {
    readonly event: KeyboardEvent;
    readonly apple: boolean;
    /* The keyboard is on the canvas itself: not in a node, a dialog, a text field or a view of its own. */
    onCanvas(): boolean;
    is(shortcut: Shortcut): boolean;
}

/* What a command does, whoever gives it: the menu, the palette, a key or a button. */
export interface CommandBehavior {
    run(): void;
    /*
     * Whether the palette offers the row at this moment, and in which words. Absent offers it always. The
     * palette cannot grey a row, so a command that cannot act now answers false.
     */
    offered?(moment: CommandMoment): boolean | PaletteOptions;
    /* A frame later, since the palette hands the focus back as it closes and that focus says which surface is meant. */
    afterClose?: true;
    /* "canvas" for a key that only acts with the keyboard on the canvas: it is tried after the keys that work from anywhere. */
    keyTier?: 'canvas';
    /* The key of the table's row; true when the key is spoken for, whether or not it did anything. Absent runs the command. */
    key?(press: KeyPress): boolean;
    /* The same in the capture phase, before any other listener hears the key; true stops it. */
    captureKey?(press: KeyPress): boolean;
}

const behaviors = new Map<string, CommandBehavior>();

export function defineBehaviors<const Ids extends string>(table: Readonly<Record<Ids, CommandBehavior>>): Readonly<Record<Ids, CommandBehavior>> {
    return table;
}

/*
 * Adds what the rows of one feature do. An id twice is a wiring mistake, except under a dev server that
 * replaces modules: Vite runs the wiring again when a feature module changes, and the new behavior takes the
 * place of the old. A build and the tests have no `import.meta.hot`, so there it throws. `replacing` is the seam for a test.
 */
export function registerBehaviors(table: Readonly<Record<string, CommandBehavior>>, replacing: boolean = import.meta.hot !== undefined): void {
    for (const [id, behavior] of Object.entries(table)) {
        if (!replacing && behaviors.has(id)) {
            throw new Error(`The command "${id}" has two behaviors.`);
        }
        behaviors.set(id, behavior);
    }
}

export function behaviorOf(id: string): CommandBehavior | undefined {
    return behaviors.get(id);
}

/* Runs a row for the menu or the palette; a frame later where the row asks for it. */
export function runBehavior(id: string): void {
    const behavior = behaviors.get(id);
    if (behavior === undefined) {
        return;
    }
    if (behavior.afterClose) {
        requestAnimationFrame(() => behavior.run());
    } else {
        behavior.run();
    }
}

export type KeyHandler = (press: KeyPress) => boolean;

const keyHandlers: KeyHandler[] = [];
const canvasKeyHandlers: KeyHandler[] = [];

/* Keys that belong to no row of the table (a view by number, a page's back), tried after the row's own handler. */
export function registerKeyHandlers(...handlers: readonly KeyHandler[]): void {
    keyHandlers.push(...handlers);
}

export function rawKeyHandlers(): readonly KeyHandler[] {
    return keyHandlers;
}

/* Keys that only act with the keyboard on the canvas, tried last. */
export function registerCanvasKeyHandlers(...handlers: readonly KeyHandler[]): void {
    canvasKeyHandlers.push(...handlers);
}

export function rawCanvasKeyHandlers(): readonly KeyHandler[] {
    return canvasKeyHandlers;
}

/* Drops the key handlers of both kinds, so the install of the commands can run again (`wiring/workspace-commands.ts`). */
export function clearKeyHandlers(): void {
    keyHandlers.length = 0;
    canvasKeyHandlers.length = 0;
}

export function takeKey(press: KeyPress, run: () => void): true {
    press.event.preventDefault();
    run();

    return true;
}
