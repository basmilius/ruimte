import type { Editor, EditorChangeMarkHover, EditorRect } from '@adecore/editor';
import { realTimers, type Timers } from '@adecore/editor-react';
import { replaceLines } from '@adecore/editor-react/models';
import { diffLines, splitLines, type Change } from '@adecore/merge';
import { createStore } from 'zustand';

export interface ChangePreview {
    readonly key: number;
    readonly line: number;
    readonly source: string;
    readonly change: Change;
    readonly before: readonly string[];
    readonly after: readonly string[];
    readonly rect: EditorRect;
}

/* A card is allowed to cross the gap from its gutter mark before it closes. */
const CARD_GRACE_MS = 200;

export function createChangePreview(editor: Editor, base: string, timers: Timers = realTimers) {
    const state = createStore<{ preview: ChangePreview | null }>(() => ({ preview: null }));
    let key = 0;
    let inside = false;
    let hide: unknown = null;
    let disposed = false;
    const old = splitLines(base);
    let frame: { source: string; fresh: string[]; changes: Change[]; lineCount: number } | null = null;
    const close = (): void => {
        timers.clear(hide);
        inside = false;
        state.setState({ preview: null });
    };
    const leave = (): void => {
        timers.clear(hide);
        hide = timers.set(() => {
            if (!inside) {
                close();
            }
        }, CARD_GRACE_MS);
    };
    const hovered = (hover: EditorChangeMarkHover | null): void => {
        if (hover === null) {
            leave();
            return;
        }

        if (hover.layer !== 'git') {
            close();
            return;
        }

        if (frame === null) {
            const source = editor.getText();
            const fresh = splitLines(source);
            frame = { source, fresh, changes: diffLines(old, fresh), lineCount: editor.positionAt(source.length).line + 1 };
        }

        const { source, fresh, changes, lineCount } = frame;
        const change = changes.find((candidate) =>
            hover.mark.kind === 'deleted'
                ? candidate.otherStart === candidate.otherEnd && Math.max(1, Math.min(lineCount, candidate.otherStart + 1)) === hover.line
                : candidate.otherStart < hover.line && candidate.otherEnd >= hover.line
        );

        if (change === undefined) {
            close();
            return;
        }

        timers.clear(hide);
        const previous = state.getState().preview;
        const same =
            previous?.line === hover.line &&
            previous.source === source &&
            previous.change.baseStart === change.baseStart &&
            previous.change.otherStart === change.otherStart;
        state.setState({
            preview: {
                key: same ? previous.key : ++key,
                source,
                line: hover.line,
                change,
                before: old.slice(change.baseStart, change.baseEnd),
                after: fresh.slice(change.otherStart, change.otherEnd),
                rect: hover.rect
            }
        });
    };
    const stopHover = editor.onChangeMarkHover?.(hovered);
    const stopChange = editor.onTextChange(() => {
        frame = null;
        close();
    });

    return {
        getState: state.getState,
        subscribe: state.subscribe,
        hold(held: boolean): void {
            inside = held;
            if (held) {
                timers.clear(hide);
            } else {
                leave();
            }
        },
        revert(): boolean {
            const preview = state.getState().preview;
            if (disposed || preview === null || editor.getText() !== preview.source) {
                close();
                return false;
            }

            const applied = editor.applyEdits([
                replaceLines(preview.source, {
                    from: preview.change.otherStart,
                    to: preview.change.otherEnd,
                    lines: preview.before
                })
            ]);
            close();
            if (applied) {
                editor.focus();
            }
            return applied;
        },
        dispose(): void {
            disposed = true;
            stopHover?.();
            stopChange();
            close();
        }
    };
}
