import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Editor, EditorFindState } from '@adecore/editor';
import { compileFind, type FindQuery } from '@/find/query';
import { openFocusedFind } from '@/find/hosts';
import { lastFindQuery, type FindSeed, type FindState } from '@/find/use-find';
import { requiredShortcut } from '@/shell/editor-keymap';
import { focusedEditor } from '@/shell/panels/focused-editor';
import { isApplePlatform } from '@/desktop/bridge';
import { matchesShortcut } from '@adecore/ui';

const NOTHING: EditorFindState = { count: 0, current: null };

/* What stepping to the next or the previous match does in each editor, for the menu and the palette. */
const steppers = new Map<Editor, (direction: 1 | -1) => void>();

/* Goes to the next or the previous match in the editor that has the keyboard; false when none does. */
export function stepFocusedEditorFind(direction: 1 | -1): boolean {
    const editor = focusedEditor();
    const step = editor === null ? undefined : steppers.get(editor);
    step?.(direction);
    return step !== undefined;
}

/* A selection longer than this is not a thing someone looks for. */
const SEED_LIMIT = 10_000;

export interface EditorFind {
    total: number;
    current: number | null;
    invalid: boolean;
    /* A search in the selection was asked for and nothing is selected. */
    noSelection: boolean;
    step(direction: 1 | -1): void;
    /* Writes `find.replaceText` in place of the match the find is on, or of every match. */
    replace(): void;
    replaceAll(): void;
    /* Puts a caret on every match and closes the bar. */
    selectAll(): void;
}

/* A regular expression finds the text it was given, not a pattern made of it. */
function escapePattern(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/*
 * What the bar opens on in an editor: the text that is selected, and for a replace over several lines
 * the selection as the place to search, with the search text left as it was.
 */
export function seedFromSelection(editor: Editor, replace: boolean, query: FindQuery): Partial<FindQuery> | null {
    const range = editor.getSelection();
    if (range.start.line === range.end.line && range.start.character === range.end.character) {
        return null;
    }
    const text = editor.textInRange(range);
    if (text === '' || text.length >= SEED_LIMIT) {
        return null;
    }
    if (replace && text.includes('\n')) {
        return { inSelection: true, ...(query.text.includes('\n') ? { text: '' } : {}) };
    }
    return { text: query.regex ? escapePattern(text) : text, inSelection: false };
}

/* The seed a file's find bar takes from its editor. */
export function editorSeed(editor: Editor | null): FindSeed | undefined {
    return editor === null ? undefined : (options, query) => seedFromSelection(editor, options.replace, query);
}

function queryOf(query: FindQuery) {
    return { text: query.text, caseSensitive: query.caseSensitive, wholeWord: query.wholeWord, regex: query.regex, inSelection: query.inSelection === true };
}

/*
 * The find bar over a file's editor. The editor matches and marks with its own find; the query is only
 * compiled here to say whether a pattern is invalid, in the same words as every other surface. Closing
 * the bar leaves the cursor on the match it was on.
 */
export function useEditorFind(find: FindState, editor: Editor | null): EditorFind {
    const [state, setState] = useState<EditorFindState>(NOTHING);
    const compiled = useMemo(() => compileFind(find.query), [find.query]);
    const wasOpen = useRef(false);
    const latest = useRef({ find, compiled });
    useLayoutEffect(() => {
        latest.current = { find, compiled };
    });

    useEffect(() => editor?.onFind(setState), [editor]);

    useEffect(() => {
        if (editor === null) {
            return;
        }
        if (find.open) {
            wasOpen.current = true;
            editor.find(compiled.kind === 'pattern' ? queryOf(find.query) : null);
        } else if (wasOpen.current) {
            wasOpen.current = false;
            editor.endFind();
        }
    }, [editor, find.open, find.query, compiled]);

    useEffect(() => {
        if (editor === null) {
            return;
        }
        const preview = find.open && find.replaceOpen && compiled.kind === 'pattern' ? find.replaceText : null;
        editor.setReplacePreview(preview, { preserveCase: find.preserveCase });
    }, [editor, find.open, find.replaceOpen, find.replaceText, find.preserveCase, compiled, find.query]);

    // Find next and previous and replace are the editor's keys while it has the keyboard, with the bar open or not.
    useEffect(() => {
        if (editor === null) {
            return;
        }
        const apple = isApplePlatform();
        const step = (direction: 1 | -1): void => {
            const remembered = lastFindQuery();
            if (latest.current.find.open) {
                editor.findStep(direction);
            } else if (remembered.text === '') {
                openFocusedFind();
            } else {
                editor.findFromCursor(queryOf(remembered), direction);
            }
        };
        steppers.set(editor, step);
        const off = editor.onKeyDown((event) => {
            const forward = matchesShortcut(requiredShortcut('findNext'), event, apple);
            if (forward || matchesShortcut(requiredShortcut('findPrevious'), event, apple)) {
                step(forward ? 1 : -1);
                return true;
            }
            if (matchesShortcut(requiredShortcut('replace'), event, apple)) {
                openFocusedFind({ replace: true });
                return true;
            }
            return false;
        });
        return () => {
            steppers.delete(editor);
            off();
        };
    }, [editor]);

    return {
        total: find.open ? state.count : 0,
        current: find.open ? state.current : null,
        invalid: find.open && compiled.kind === 'invalid',
        noSelection: find.open && state.noSelection === true,
        step: (direction) => editor?.findStep(direction),
        replace: () => void editor?.replace(find.replaceText, { preserveCase: find.preserveCase }),
        replaceAll: () => void editor?.replaceAll(find.replaceText, { preserveCase: find.preserveCase }),
        selectAll: () => {
            if (editor !== null && editor.selectFindMatches() > 0) {
                find.close();
            }
        }
    };
}
