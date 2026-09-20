import { expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { dictationLevelsEffect, dictationPreview, dictationPreviewEffect, dictationRange, dictationRangeEffect } from './editor';
import { externalChange } from '@/chat/ui/composer/editor';

test('the insertion follows edits ahead of its selection', () => {
    let state = EditorState.create({ doc: 'one two three', extensions: [dictationRange] });
    state = state.update({ effects: dictationRangeEffect.of({ from: 4, to: 7 }) }).state;
    state = state.update({ changes: { from: 0, insert: 'new ' } }).state;
    expect(state.field(dictationRange)).toEqual({ from: 8, to: 11 });
    state = state.update({ selection: { anchor: 0 } }).state;
    expect(state.field(dictationRange)).toEqual({ from: 8, to: 11 });
});
test('replacing the draft invalidates a pending dictation', () => {
    let state = EditorState.create({ doc: 'draft', extensions: [dictationRange] });
    state = state.update({ effects: dictationRangeEffect.of({ from: 5, to: 5 }) }).state;
    state = state.update({ changes: { from: 0, to: 5, insert: '' }, annotations: externalChange.of(true) }).state;
    expect(state.field(dictationRange)).toBeNull();
});

test('live snapshots replace the inline preview without changing the draft', () => {
    let state = EditorState.create({ doc: 'Before selected after', extensions: [dictationRange, dictationPreview] });
    state = state.update({ effects: dictationRangeEffect.of({ from: 7, to: 15 }) }).state;
    for (const text of ['a test', 'a corrected test']) {
        state = state.update({ effects: dictationPreviewEffect.of(text) }).state;
        expect(state.doc.toString()).toBe('Before selected after');
        expect(state.field(dictationPreview).text).toBe(text);
        const decoration = state.field(dictationPreview).decorations.iter();
        expect([decoration.from, decoration.to]).toEqual([7, 15]);
    }
    state = state.update({ effects: dictationRangeEffect.of(null) }).state;
    expect(state.field(dictationPreview).decorations.size).toBe(0);
    expect(state.doc.toString()).toBe('Before selected after');
});

test('replacing a draft removes the preview and ignores late snapshots', () => {
    let state = EditorState.create({ extensions: [dictationRange, dictationPreview] });
    state = state.update({ effects: dictationRangeEffect.of({ from: 0, to: 0 }) }).state;
    state = state.update({ effects: dictationPreviewEffect.of('Pending speech') }).state;
    expect(state.field(dictationPreview).decorations.size).toBe(1);
    state = state.update({ changes: { from: 0, insert: 'Restored draft' }, annotations: externalChange.of(true) }).state;
    state = state.update({ effects: dictationPreviewEffect.of('Stale speech') }).state;
    expect(state.field(dictationPreview).decorations.size).toBe(0);
    expect(state.doc.toString()).toBe('Restored draft');
});

test('the waveform follows the preview and disappears on stop or cancellation', () => {
    let state = EditorState.create({ doc: 'before after', extensions: [dictationRange, dictationPreview] });
    state = state.update({ effects: dictationRangeEffect.of({ from: 7, to: 7 }) }).state;
    state = state.update({ effects: dictationLevelsEffect.of([]) }).state;
    expect(state.field(dictationPreview).decorations.size).toBe(1);
    state = state.update({ effects: [dictationPreviewEffect.of('spoken '), dictationLevelsEffect.of([0.2, 0.8])] }).state;
    expect(state.field(dictationPreview).decorations.size).toBe(2);
    expect(state.doc.toString()).toBe('before after');
    state = state.update({ effects: dictationLevelsEffect.of(null) }).state;
    expect(state.field(dictationPreview).decorations.size).toBe(1);
    expect(state.field(dictationPreview).text).toBe('spoken ');
    state = state.update({ effects: dictationRangeEffect.of(null) }).state;
    expect(state.field(dictationPreview).decorations.size).toBe(0);
    expect(state.field(dictationPreview).levels).toBeNull();
});
