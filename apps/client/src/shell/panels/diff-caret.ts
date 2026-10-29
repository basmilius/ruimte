import { useRef, type RefObject } from 'react';
import { create } from 'zustand';
import type { DiffSource } from '@adecore/editor-react';
import type { DiffSourceLine } from '@adecore/merge';
import { matchesShortcut } from '@adecore/ui';
import { ignoreRefusal, perform } from '@/actions/client-actions';
import { isApplePlatform } from '@/desktop/bridge';
import { cellElement } from '@/shell/cell-rects';
import { requiredShortcut } from '@/shell/editor-keymap';
import { createFocusRegistry } from '@/shell/panels/focus-registry';
import { useDocument } from '@/state/document';

interface DiffCaretStore {
    /* Where the caret of each diff tab stands in its file, keyed by the tab, so the tab's menu can say the line. In memory only. */
    carets: Record<string, DiffSourceLine>;
    setCaret(key: string, at: DiffSourceLine | null): void;
}

export const useDiffCarets = create<DiffCaretStore>((set, get) => ({
    carets: {},
    setCaret(key, at) {
        const current = get().carets[key];
        if (current?.line === at?.line && current?.column === at?.column) {
            return;
        }
        const { [key]: _dropped, ...rest } = get().carets;
        set({ carets: at === null ? rest : { ...rest, [key]: at } });
    }
}));

/* A diff and the element it draws in, so the palette and the menu open the file of the diff that has the keyboard. */
const diffs = createFocusRegistry<() => boolean>();

function openAt(path: string, source: DiffSource): boolean {
    const at = source.at();
    if (at === null) {
        return false;
    }
    void perform('file.preview', { path, line: at.line, column: at.column }).catch(ignoreRefusal);
    return true;
}

/* Opens the file at the caret of the diff with the keyboard, else of the diff the active view had it last. */
export function openFileAtDiffCaret(): boolean {
    const focused = diffs.focused();
    if (focused !== null) {
        return focused();
    }
    const state = useDocument.getState();
    return (state.activeViewId === null ? null : diffs.recentIn(cellElement(state.activeViewId)))?.() ?? false;
}

/*
 * What a diff of the file at `path` (absolute) hands `UnifiedDiff`: its panes open the file at the caret on
 * Jump to Source and keep the caret's place under `tabKey`. The key is the diff's own, bound on its editors
 * and not on `window`, since a file's editor gives the same key to Text End or Method Down.
 */
export function useDiffCaret(path: string, tabKey: string): { surface: RefObject<HTMLDivElement | null>; onSource(source: DiffSource): () => void } {
    const surface = useRef<HTMLDivElement>(null);
    // The pane the caret moved in last, which is the one a split diff means.
    const last = useRef<DiffSource | null>(null);

    // The panes mount once the diff is read, so they register the element around them, which exists by then.
    const onSource = (source: DiffSource): (() => void) => {
        const apple = isApplePlatform();
        const remember = (): void => {
            last.current = source;
            useDiffCarets.getState().setCaret(tabKey, source.at());
        };
        const element = surface.current;
        const offFocus = element === null ? undefined : diffs.register(() => last.current !== null && openAt(path, last.current), element);
        const offCaret = source.editor.onCaret(remember);
        const offKey = source.editor.onKeyDown((event) => {
            if (!matchesShortcut(requiredShortcut('jumpToSource'), event, apple)) {
                return false;
            }
            remember();
            return openAt(path, source);
        });
        return () => {
            offFocus?.();
            offCaret();
            offKey();
            if (last.current === source) {
                last.current = null;
                useDiffCarets.getState().setCaret(tabKey, null);
            }
        };
    };

    return { surface, onSource };
}
