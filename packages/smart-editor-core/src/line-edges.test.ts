import { describe, expect, it } from 'bun:test';
import { DocumentModel } from './document.ts';
import type { CommandOptions } from './types.ts';

function press(model: DocumentModel, command: 'smartHome' | 'smartEnd' | 'selectSmartHome' | 'selectSmartEnd', options: CommandOptions = {}): number {
    model.execute(command, options);
    return model.getPrimary().head;
}

function at(model: DocumentModel, offset: number): void {
    model.setSelections([{ anchor: offset, head: offset }]);
}

describe('Home', () => {
    it('goes from the text to the first character, and from there and from inside the indentation to the start', () => {
        const model = new DocumentModel('    foo bar');
        at(model, 9);
        expect(press(model, 'smartHome')).toBe(4);
        expect(press(model, 'smartHome')).toBe(0);
        expect(press(model, 'smartHome')).toBe(4);
        at(model, 2);
        expect(press(model, 'smartHome')).toBe(0);
    });

    it('goes from the start of a blank line to where the nearest line above begins', () => {
        const model = new DocumentModel('  foo\n\n    ');
        at(model, 6);
        expect(press(model, 'smartHome')).toBe(6);
        at(model, 7);
        expect(press(model, 'smartHome')).toBe(9);
        at(model, 11);
        expect(press(model, 'smartHome')).toBe(7);
        expect(press(model, 'smartHome')).toBe(9);
    });

    it('counts a tab as the columns it takes, and ends on a shorter line', () => {
        const model = new DocumentModel('\tfoo\n  \n');
        at(model, 5);
        expect(press(model, 'smartHome', { tabSize: 4 })).toBe(7);
        expect(press(model, 'smartHome', { tabSize: 4 })).toBe(5);
        const wide = new DocumentModel('\tfoo\n\t  \n');
        at(wide, 5);
        expect(press(wide, 'smartHome', { tabSize: 4 })).toBe(6);
    });

    it('extends the selection', () => {
        const model = new DocumentModel('  foo');
        at(model, 5);
        model.execute('selectSmartHome');
        expect(model.getSelections()).toEqual([{ anchor: 5, head: 2 }]);
    });
});

describe('Home and End on a wrapped line', () => {
    const text = 'aaaa bbbb cccc dddd';
    const rows: CommandOptions = {
        visualLine: (offset) => (offset < 10 ? { start: 0, end: 10 } : { start: 10, end: 19 })
    };

    it('goes to the start of the row, and then to the first character of the line', () => {
        const model = new DocumentModel(text);
        at(model, 14);
        expect(press(model, 'smartHome', rows)).toBe(10);
        expect(press(model, 'smartHome', rows)).toBe(0);
    });

    it('goes to the end of the row text, then to the end of the row, then to the end of the line', () => {
        const model = new DocumentModel(text);
        at(model, 2);
        expect(press(model, 'smartEnd', rows)).toBe(9);
        expect(press(model, 'smartEnd', rows)).toBe(10);
        const second = { visualLine: (offset: number) => (offset === 10 ? { start: 0, end: 10 } : rows.visualLine!(offset)) };
        expect(press(model, 'smartEnd', second)).toBe(19);
    });
});

describe('End', () => {
    it('goes before the trailing spaces and then past them', () => {
        const model = new DocumentModel('foo  \nbar');
        at(model, 1);
        expect(press(model, 'smartEnd')).toBe(3);
        expect(press(model, 'smartEnd')).toBe(5);
        expect(press(model, 'smartEnd')).toBe(3);
        at(model, 4);
        expect(press(model, 'smartEnd')).toBe(3);
    });

    it('goes to the end of a line that has no trailing spaces', () => {
        const model = new DocumentModel('foo\nbar');
        at(model, 1);
        expect(press(model, 'smartEnd')).toBe(3);
        at(model, 5);
        expect(press(model, 'smartEnd')).toBe(7);
    });
});
