import { expect, test } from 'bun:test';
import { resizedText } from './text-resize';

test('resizing either side keeps the opposite edge fixed', () => {
    expect(resizedText(100, 200, 'right', 60)).toEqual({ x: 100, maxWidth: 260 });
    expect(resizedText(100, 200, 'left', -60)).toEqual({ x: 40, maxWidth: 260 });
    expect(resizedText(100, 200, 'left', 60)).toEqual({ x: 160, maxWidth: 140 });
});

test('the minimum width keeps the opposite edge fixed even when crossing it', () => {
    expect(resizedText(100, 200, 'left', 300)).toEqual({ x: 260, maxWidth: 40 });
    expect(resizedText(100, 200, 'right', -300)).toEqual({ x: 100, maxWidth: 40 });
});
