import type { EditorPosition, EditorRange, EditorTextChange } from '@adecore/editor';
import { comparePositions, rangeHolds, shiftRange } from './diagnostics-model';
import type { EditorLanguage } from './editor-language';
import type { SnippetStop } from './snippet';

/* Where an offset of inserted text lands when the text is put in at `start`. */
export function positionInInsertion(start: EditorPosition, text: string, offset: number): EditorPosition {
    const lines = text.slice(0, offset).split(/\r\n|\r|\n/);
    return lines.length === 1
        ? { line: start.line, character: start.character + offset }
        : { line: start.line + lines.length - 1, character: lines[lines.length - 1]!.length };
}

/*
 * The tab stops of a snippet that was just inserted. The caret goes to the first one, with its default text
 * selected; Tab goes on to the next and Shift+Tab back, and the last stop (`$0`, or the end of the text)
 * ends it. Escape, a caret that leaves the snippet and any change that is not typing end it too. Typing in
 * a stop does not touch the others: they follow the text, but a mirror of a stop is not edited along.
 */
export class SnippetFeature {
    private readonly language: EditorLanguage;
    private stops: EditorRange[] = [];
    private current = 0;

    constructor(language: EditorLanguage) {
        this.language = language;
        const { editor } = language;
        const offs = [
            editor.onKeyDown((event) => this.key(event)),
            editor.onTextChange((change) => this.edited(change)),
            editor.onCaret((position) => this.moved(position))
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
        });
    }

    get isActive(): boolean {
        return this.stops.length > 0;
    }

    /* Puts the caret where the snippet says, and keeps the stops to go through when there is more than the last one. */
    begin(start: EditorPosition, text: string, stops: readonly SnippetStop[]): void {
        this.end();
        if (stops.length === 0) {
            return;
        }
        const ranges = stops.map((stop) => ({ start: positionInInsertion(start, text, stop.start), end: positionInInsertion(start, text, stop.end) }));
        if (ranges.length === 1) {
            this.language.editor.setCaret(ranges[0]!.start);
            return;
        }
        this.stops = ranges;
        this.visit(0);
    }

    end(): void {
        this.stops = [];
        this.current = 0;
    }

    private visit(index: number): void {
        const { editor } = this.language;
        const target = this.stops[index]!;
        this.current = index;
        if (comparePositions(target.start, target.end) === 0) {
            editor.setCaret(target.start);
        } else {
            editor.setSelection(target);
        }
        if (index === this.stops.length - 1) {
            this.end();
        }
    }

    private key(event: KeyboardEvent): boolean {
        if (!this.isActive || event.ctrlKey || event.metaKey || event.altKey) {
            return false;
        }
        if (event.key === 'Tab') {
            this.visit(event.shiftKey ? Math.max(0, this.current - 1) : this.current + 1);
            return true;
        }
        if (event.key === 'Escape') {
            this.end();
            return true;
        }
        return false;
    }

    private edited(change: EditorTextChange): void {
        if (!this.isActive) {
            return;
        }
        if (change.source !== 'input') {
            this.end();
            return;
        }
        this.stops = this.stops.map((stop) => shiftRange(stop, change.changes));
    }

    /* A caret outside the stretch the stops span is a person moving on. */
    private moved(position: EditorPosition): void {
        if (!this.isActive) {
            return;
        }
        const hull = { start: this.stops[0]!.start, end: this.stops[this.stops.length - 1]!.end };
        for (const stop of this.stops) {
            if (comparePositions(stop.start, hull.start) < 0) {
                hull.start = stop.start;
            }
            if (comparePositions(stop.end, hull.end) > 0) {
                hull.end = stop.end;
            }
        }
        if (!rangeHolds(hull, position)) {
            this.end();
        }
    }
}
