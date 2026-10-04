import type { EditorCommand } from '@ruimte/smart-editor-core';
import type { KeyChord } from './types.ts';

export interface KeyLike {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
}

export type MoveKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'PageUp' | 'PageDown';

export type KeyAction =
    | { readonly type: 'command'; readonly command: EditorCommand }
    | { readonly type: 'move'; readonly key: MoveKey; readonly extend: boolean }
    | { readonly type: 'edge'; readonly end: boolean; readonly extend: boolean }
    | { readonly type: 'bracket'; readonly extend: boolean }
    | { readonly type: 'fold'; readonly collapse: boolean; readonly all: boolean }
    | { readonly type: 'save' }
    | { readonly type: 'escape' };

const MOVES = new Set<string>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown']);

function command(name: EditorCommand): KeyAction {
    return { type: 'command', command: name };
}

/* Whether the physical modifiers of an event are the ones a chord names, with `mod` as Cmd on macOS and Ctrl elsewhere. */
export function chordMatches(chord: KeyChord, event: KeyLike, apple: boolean): boolean {
    const key = chord.key.length === 1 ? chord.key.toUpperCase() : chord.key;
    const pressed = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    if (key !== pressed) {
        return false;
    }
    const wantsMeta = chord.meta || (chord.mod && apple);
    const wantsCtrl = chord.ctrl || (chord.mod && !apple);
    return wantsMeta === event.metaKey && wantsCtrl === event.ctrlKey && chord.alt === event.altKey && chord.shift === event.shiftKey;
}

/*
 * What a key does in the editor, or null when it is not the editor's, which leaves it to the page and
 * to the textarea. Movement of the caret is the view's, since it depends on how the lines are drawn.
 */
export function keyAction(event: KeyLike, apple: boolean): KeyAction | null {
    const key = event.key.toLowerCase();
    const mod = apple ? event.metaKey : event.ctrlKey;
    const { altKey: alt, shiftKey: shift, ctrlKey: ctrl, metaKey: meta } = event;
    if (mod && !alt && key === 's') {
        return { type: 'save' };
    }
    if (ctrl && shift && key === 'm') {
        return { type: 'bracket', extend: alt };
    }
    if (mod && !alt && (key === '-' || key === '=' || key === '+')) {
        return { type: 'fold', collapse: key === '-', all: shift };
    }
    if ((mod && (key === 'home' || key === 'end')) || (meta && (key === 'arrowup' || key === 'arrowdown'))) {
        return { type: 'edge', end: key === 'end' || key === 'arrowdown', extend: shift };
    }
    if (mod && key === 'z') {
        return command(shift ? 'redo' : 'undo');
    }
    if (ctrl && key === 'y') {
        return command('redo');
    }
    if (mod && key === 'a') {
        return command('selectAll');
    }
    if (mod && key === 'd') {
        return command('duplicateLine');
    }
    if (mod && key === 'g') {
        return command('selectNextOccurrence');
    }
    if (mod && key === '/') {
        return command('toggleLineComment');
    }
    if (mod && shift && key === 'k') {
        return command('deleteLine');
    }
    if (ctrl && key === 'w') {
        return command(shift ? 'shrinkSelection' : 'expandSelection');
    }
    if (alt && (shift || ctrl) && (key === 'arrowup' || key === 'arrowdown')) {
        return command(key === 'arrowup' ? 'addCaretAbove' : 'addCaretBelow');
    }
    if (alt && !mod && key === 'arrowup') {
        return command('moveLineUp');
    }
    if (alt && !mod && key === 'arrowdown') {
        return command('moveLineDown');
    }
    if (alt && !mod && key === 'j') {
        return command('selectNextOccurrence');
    }
    if (meta && key === 'arrowleft') {
        return command(shift ? 'selectSmartHome' : 'smartHome');
    }
    if (meta && key === 'arrowright') {
        return command(shift ? 'selectSmartEnd' : 'smartEnd');
    }
    if ((alt || ctrl) && key === 'arrowleft') {
        return command(shift ? 'selectWordLeft' : 'wordLeft');
    }
    if ((alt || ctrl) && key === 'arrowright') {
        return command(shift ? 'selectWordRight' : 'wordRight');
    }
    if ((alt || ctrl) && key === 'backspace') {
        return command('deleteWordLeft');
    }
    if ((alt || ctrl) && key === 'delete') {
        return command('deleteWordRight');
    }
    if (mod || alt || ctrl || meta) {
        return null;
    }
    if (key === 'home') {
        return command(shift ? 'selectSmartHome' : 'smartHome');
    }
    if (key === 'end') {
        return command(shift ? 'selectSmartEnd' : 'smartEnd');
    }
    if (key === 'tab') {
        return command(shift ? 'outdent' : 'insertTab');
    }
    if (key === 'enter') {
        return command('insertNewline');
    }
    if (key === 'backspace') {
        return command('smartBackspace');
    }
    if (key === 'delete') {
        return command('deleteForward');
    }
    if (MOVES.has(event.key)) {
        return { type: 'move', key: event.key as MoveKey, extend: shift };
    }
    if (key === 'escape') {
        return { type: 'escape' };
    }
    return null;
}
