import { describe, expect, it, spyOn } from 'bun:test';
import { DocumentModel } from './document.ts';
import { TextRope } from './rope.ts';
import type { EditorSnapshot } from './types.ts';

describe('incremental document change metadata', () => {
    it('deletes complete combining and emoji graphemes while retaining UTF-16 positions', () => {
        const model = new DocumentModel('e\u0301👨‍👩‍👧‍👦x');
        model.setSelections([{ anchor: 2, head: 2 }]);
        model.execute('smartBackspace');
        expect(model.getText()).toBe('👨‍👩‍👧‍👦x');
        model.execute('deleteForward');
        expect(model.getText()).toBe('x');
        model.undo();
        model.undo();
        expect(model.getText()).toBe('e\u0301👨‍👩‍👧‍👦x');
    });
    it('emits simultaneous spans and sequential inverse spans for grouped undo', () => {
        const model = new DocumentModel('abcdef');
        const events: EditorSnapshot[] = [];
        model.subscribe((snapshot) => events.push(snapshot));
        model.applyEdits(
            [
                { from: 1, to: 2, text: 'XY' },
                { from: 4, to: 5, text: '' }
            ],
            { historyGroup: 'typing', source: 'input' }
        );
        model.applyEdits([{ from: 5, to: 5, text: '!' }], { historyGroup: 'typing', source: 'input' });
        expect(model.getText()).toBe('aXYcd!f');
        expect(events[0].changes).toEqual([
            [
                { from: 1, to: 2, insertedLength: 2 },
                { from: 4, to: 5, insertedLength: 0 }
            ]
        ]);
        model.undo();
        expect(model.getText()).toBe('abcdef');
        expect(events[2].changes).toEqual([
            [{ from: 5, to: 6, insertedLength: 0 }],
            [
                { from: 1, to: 3, insertedLength: 1 },
                { from: 5, to: 5, insertedLength: 1 }
            ]
        ]);
        model.redo();
        expect(model.getText()).toBe('aXYcd!f');
        expect(events[3].changes).toEqual([events[0].changes![0], events[1].changes![0]]);
        model.setSelections([{ anchor: 1, head: 1 }]);
        expect(events.at(-1)?.changes).toBeUndefined();
    });

    it('describes a full-document deletion and undo without materializing either version', () => {
        const model = new DocumentModel('x'.repeat(1024 * 1024));
        const spy = spyOn(TextRope.prototype, 'slice');
        const changes: unknown[] = [];
        try {
            model.subscribe((snapshot) => changes.push(snapshot.changes));
            model.applyEdits([{ from: 0, to: model.getLength(), text: '' }]);
            model.undo();
            expect(model.getLength()).toBe(1024 * 1024);
            expect(spy).not.toHaveBeenCalled();
            expect(changes[1]).toEqual([[{ from: 0, to: 0, insertedLength: 1024 * 1024 }]]);
        } finally {
            spy.mockRestore();
        }
    });
});
