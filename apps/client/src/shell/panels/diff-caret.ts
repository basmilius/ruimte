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
import { useFiles } from '@/state/files';

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

/* Whether the view in front of the focused cell is a diff, a commit or a checkout's changes: a file tab with a view. */
export function diffInFront(): boolean {
    const { activeViewId } = useDocument.getState();
    const tab = activeViewId === null ? undefined : useFiles.getState().tabs.find((entry) => entry.key === activeViewId);
    return tab !== undefined && 'view' in tab && tab.view !== undefined;
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
    // The pane that had the keyboard last, which is the one a split diff means.
    const last = useRef<DiffSource | null>(null);

    // The panes mount once the diff is read, so they register the element around them, which exists by then.
    const onSource = (source: DiffSource): (() => void) => {
        const apple = isApplePlatform();
        // Only the pane with the keyboard speaks: the caret of the other one also moves when a gap unfolds.
        const take = (): void => {
            if (!source.editor.hasFocus?.()) {
                return;
            }
            last.current = source;
            useDiffCarets.getState().setCaret(tabKey, source.at());
        };
        const element = surface.current;
        const offFocus = element === null ? undefined : diffs.register(() => last.current !== null && openAt(path, last.current), element);
        // A pane takes over as it gets the keyboard, also before its caret first moves.
        element?.addEventListener('focusin', take);
        const offCaret = source.editor.onCaret(take);
        const offKey = source.editor.onKeyDown((event) => {
            if (!matchesShortcut(requiredShortcut('jumpToSource'), event, apple)) {
                return false;
            }
            return openAt(path, source);
        });
        return () => {
            offFocus?.();
            element?.removeEventListener('focusin', take);
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
