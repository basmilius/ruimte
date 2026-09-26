import { StateEffect, StateField } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { externalChange } from '@ruimte/agents-react/chat/ui/composer/editor';
import type { DictationInsertion } from './controller';
import { DictationError } from './engine';

export interface InsertionRange {
    from: number;
    to: number;
}
export const dictationRangeEffect = StateEffect.define<InsertionRange | null>();
export const dictationRange = StateField.define<InsertionRange | null>({
    create: () => null,
    update: (range, transaction) => {
        if (transaction.annotation(externalChange)) {
            return null;
        }
        for (const effect of transaction.effects) {
            if (effect.is(dictationRangeEffect)) {
                return effect.value;
            }
        }
        if (!range) {
            return null;
        }
        const from = transaction.changes.mapPos(range.from, 1);
        return { from, to: Math.max(from, transaction.changes.mapPos(range.to, -1)) };
    }
});

export const dictationPreviewEffect = StateEffect.define<string>();
export const dictationLevelsEffect = StateEffect.define<readonly number[] | null>();

class WaveformWidget extends WidgetType {
    readonly levels: readonly number[];

    constructor(levels: readonly number[]) {
        super();
        this.levels = levels;
    }

    eq(other: WaveformWidget): boolean {
        return this.levels === other.levels;
    }

    toDOM(): HTMLElement {
        const element = document.createElement('span');
        element.className = 'dictation-waveform';
        element.setAttribute('aria-hidden', 'true');
        for (let index = 0; index < 5; index++) {
            element.append(document.createElement('span'));
        }
        this.updateDOM(element);
        return element;
    }

    updateDOM(element: HTMLElement): boolean {
        for (let index = 0; index < 5; index++) {
            const from = Math.floor((index * this.levels.length) / 5);
            const to = Math.max(from + 1, Math.floor(((index + 1) * this.levels.length) / 5));
            let level = 0;
            for (let band = from; band < to; band++) {
                level += this.levels[band] ?? 0;
            }
            (element.children[index] as HTMLElement).style.transform = `scaleY(${(2 + Math.min(1, Math.max(0, level / (to - from))) * 12) / 14})`;
        }
        return true;
    }
}

class PreviewWidget extends WidgetType {
    readonly text: string;

    constructor(text: string) {
        super();
        this.text = text;
    }

    eq(other: PreviewWidget): boolean {
        return other.text === this.text;
    }

    toDOM(): HTMLElement {
        const element = document.createElement('span');
        element.className = 'dictation-preview';
        this.updateDOM(element);
        return element;
    }

    updateDOM(element: HTMLElement): boolean {
        const previous = element.textContent ?? '';
        let shared = 0;
        while (shared < previous.length && shared < this.text.length && previous[shared] === this.text[shared]) {
            shared++;
        }
        let remaining = shared;
        for (const child of [...element.childNodes]) {
            const length = child.textContent?.length ?? 0;
            if (remaining >= length) {
                remaining -= length;
            } else if (remaining > 0) {
                child.textContent = child.textContent!.slice(0, remaining);
                remaining = 0;
            } else {
                child.remove();
            }
        }
        if (shared < this.text.length) {
            const arriving = document.createElement('span');
            arriving.className = 'chat-fade';
            arriving.textContent = this.text.slice(shared);
            element.append(arriving);
        }
        return true;
    }
}

export const dictationPreview = StateField.define<{ text: string; levels: readonly number[] | null; decorations: DecorationSet }>({
    create: () => ({ text: '', levels: null, decorations: Decoration.none }),
    update: (previous, transaction) => {
        const range = transaction.state.field(dictationRange);
        let text = range ? previous.text : '';
        let levels = range ? previous.levels : null;
        for (const effect of transaction.effects) {
            if (effect.is(dictationPreviewEffect) && range) {
                text = effect.value;
            }
            if (effect.is(dictationLevelsEffect) && range) {
                levels = effect.value;
            }
        }
        const widget = new PreviewWidget(text);
        const marks = [];
        if (range && text) {
            marks.push(
                range.from === range.to ? Decoration.widget({ widget, side: 1 }).range(range.from) : Decoration.replace({ widget }).range(range.from, range.to)
            );
        }
        if (range && levels !== null) {
            marks.push(Decoration.widget({ widget: new WaveformWidget(levels), side: 2 }).range(range.to));
        }
        return { text, levels, decorations: Decoration.set(marks, true) };
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
});

export const captureEditor = (view: EditorView): DictationInsertion | null => {
    if (view.state.readOnly) {
        return null;
    }
    const { from, to } = view.state.selection.main;
    view.dispatch({ effects: dictationRangeEffect.of({ from, to }) });
    return {
        levels: (bands) => {
            if (view.dom.isConnected && view.state.field(dictationRange)) {
                view.dispatch({ effects: dictationLevelsEffect.of(bands) });
            }
        },
        preview: (text) => {
            if (view.dom.isConnected && view.state.field(dictationRange)) {
                view.dispatch({ effects: dictationPreviewEffect.of(text) });
            }
        },
        insert: (text) => {
            const range = view.state.field(dictationRange);
            if (!range || view.state.readOnly || !view.dom.isConnected) {
                throw new DictationError('targetChanged');
            }
            view.dispatch({
                changes: { ...range, insert: text },
                selection: { anchor: range.from + text.length },
                effects: dictationRangeEffect.of(null),
                scrollIntoView: true,
                annotations: isolateHistory.of('full')
            });
            view.focus();
        },
        dispose: () => {
            if (view.dom.isConnected) {
                view.dispatch({ effects: dictationRangeEffect.of(null) });
            }
        }
    };
};
