import { describe, expect, test } from 'bun:test';
import type { Point } from '../canvas-model/math';
import { answerCanvasPaste, type CanvasPasteReach } from './canvas-paste';

interface Pasted {
    prevented: boolean;
    notes: Array<{ content: string; at: Point | null }>;
}

function paste(text: string, reach: Partial<CanvasPasteReach> = {}): Pasted {
    const pasted: Pasted = { prevented: false, notes: [] };
    answerCanvasPaste(
        {
            target: null,
            clipboardData: { getData: (format: string) => (format === 'text/plain' ? text : '') } as DataTransfer,
            defaultPrevented: false,
            preventDefault: () => {
                pasted.prevented = true;
            }
        },
        {
            onCanvas: () => true,
            pointer: () => ({ x: 120, y: -40 }),
            createNote: (content, at) => pasted.notes.push({ content, at }),
            ...reach
        }
    );
    return pasted;
}

describe('a paste on the canvas', () => {
    test('makes a note of the text under the pointer, and takes the paste', () => {
        expect(paste('Call the printer')).toEqual({ prevented: true, notes: [{ content: 'Call the printer', at: { x: 120, y: -40 } }] });
    });

    test('leaves the place to the free spot in view when the pointer is not over the canvas', () => {
        expect(paste('Call the printer', { pointer: () => null }).notes).toEqual([{ content: 'Call the printer', at: null }]);
    });

    test('leaves a paste alone while something else has the keyboard', () => {
        expect(paste('Call the printer', { onCanvas: () => false })).toEqual({ prevented: false, notes: [] });
    });

    test('makes nothing of empty or blank text, and lets the paste go', () => {
        expect(paste('')).toEqual({ prevented: false, notes: [] });
        expect(paste(' \n\t \n')).toEqual({ prevented: false, notes: [] });
    });

    test('drops the blank lines around the text and keeps the indent of its first line', () => {
        expect(paste('\n\n    const answer = 42;\n    return answer;\n\n').notes[0]?.content).toBe('    const answer = 42;\n    return answer;');
    });

    test('leaves a paste something on the page already took', () => {
        const notes: string[] = [];
        answerCanvasPaste(
            { target: null, clipboardData: null, defaultPrevented: true, preventDefault: () => undefined },
            { onCanvas: () => true, pointer: () => null, createNote: (content) => notes.push(content) }
        );
        expect(notes).toEqual([]);
    });
});
