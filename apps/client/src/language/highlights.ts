import type { DocumentHighlight } from '@ruimte/smart-editor-lsp';
import type { EditorHighlight, EditorHighlightKind, EditorPosition, EditorRange } from '@ruimte/smart-editor';
import { comparePositions, rangeHolds } from './diagnostics-model';
import { isIdentifierCharacter } from './completion-model';
import type { EditorLanguage } from './editor-language';
import { Refresher } from './refresher';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { isShortcut } from './shortcut-keys';
import { realTimers, type Timers } from './timers';

const METHOD = 'textDocument/documentHighlight';
const PAUSE_MS = 150;

const KINDS: Record<number, EditorHighlightKind> = { 1: 'text', 2: 'read', 3: 'write' };

export function editorHighlightsOf(highlights: readonly DocumentHighlight[]): EditorHighlight[] {
    return highlights
        .filter((highlight) => comparePositions(highlight.range.start, highlight.range.end) < 0)
        .map((highlight) => ({ range: highlight.range, kind: KINDS[highlight.kind ?? 1] ?? 'text' }))
        .sort((left, right) => comparePositions(left.range.start, right.range.start));
}

/* The range before the caret when stepping back, or after it when stepping forward, wrapping round the document; null for no ranges. */
export function neighborRange(ranges: readonly EditorRange[], from: EditorPosition, direction: 1 | -1): EditorRange | null {
    if (ranges.length === 0) {
        return null;
    }
    const ordered = [...ranges].sort((left, right) => comparePositions(left.start, right.start));
    if (direction === 1) {
        return ordered.find((range) => comparePositions(range.start, from) > 0) ?? ordered[0]!;
    }
    return [...ordered].reverse().find((range) => comparePositions(range.start, from) < 0) ?? ordered[ordered.length - 1]!;
}

/*
 * The other uses of the name at the caret, drawn softly in the text, which the next and previous highlight
 * keys step through. They are asked for when the caret rests on a name and go with the next edit.
 */
export class HighlightsFeature {
    private readonly language: EditorLanguage;
    private readonly refresher: Refresher;
    private current: readonly EditorHighlight[] = [];

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        this.language = language;
        const { editor, project, uri } = language;
        this.refresher = new Refresher(
            async (signal) => {
                if (!project.service.supports(METHOD, uri) || !this.onName()) {
                    this.clear();
                    return;
                }
                const result = await project.service.documentHighlights(uri, editor.getCaret(), { signal });
                if (!signal.aborted) {
                    this.set(result === null ? [] : editorHighlightsOf(result));
                }
            },
            PAUSE_MS,
            timers
        );
        const offs = [
            editor.onCaret((position) => {
                // Moving along the same name keeps its marks, which is what makes stepping through them quiet.
                if (!this.current.some((highlight) => rangeHolds(highlight.range, position))) {
                    this.clear();
                }
                this.refresher.later();
            }),
            editor.onTextChange(() => {
                // The editor drops its marks with the edit; this follows, and asks again when the caret settles.
                this.current = [];
                this.refresher.later();
            }),
            editor.onKeyDown((event) => {
                const next = isShortcut(CANVAS_SHORTCUTS.nextHighlight, event);
                if (!next && !isShortcut(CANVAS_SHORTCUTS.previousHighlight, event)) {
                    return false;
                }
                return this.step(next ? 1 : -1);
            })
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.refresher.dispose();
            editor.setHighlights([]);
        });
    }

    /* Puts the caret on the next use of the name, or the one before; false when there are none. */
    step(direction: 1 | -1): boolean {
        const { editor } = this.language;
        const target = neighborRange(
            this.current.map((highlight) => highlight.range),
            editor.getCaret(),
            direction
        );
        if (target === null) {
            return false;
        }
        editor.setCaret(target.start, comparePositions(target.start, editor.getCaret()) > 0 ? 'centerDown' : 'centerUp');
        return true;
    }

    private onName(): boolean {
        const { editor } = this.language;
        const caret = editor.getCaret();
        const before = caret.character > 0 ? editor.textInRange({ start: { line: caret.line, character: caret.character - 1 }, end: caret }) : '';
        const after = editor.textInRange({ start: caret, end: { line: caret.line, character: caret.character + 1 } });
        return (before !== '' && isIdentifierCharacter(before)) || (after !== '' && isIdentifierCharacter(after));
    }

    private set(highlights: readonly EditorHighlight[]): void {
        this.current = highlights;
        this.language.editor.setHighlights(highlights);
    }

    private clear(): void {
        if (this.current.length > 0) {
            this.set([]);
        }
    }
}
