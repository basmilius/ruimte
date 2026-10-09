import { expect, test } from 'bun:test';
import { FileLocationSchema } from './file-location';

test('file locations have one-based coordinates and an inclusive forward range', () => {
    expect(FileLocationSchema.parse({ path: 'a file.ts', line: 12, column: 4, endLine: 16 })).toEqual({ path: 'a file.ts', line: 12, column: 4, endLine: 16 });
    for (const position of [{ line: 0 }, { line: -1 }, { line: 1.2 }, { line: 1, column: 0 }, { column: 1 }, { endLine: 1 }, { line: 4, endLine: 3 }]) {
        expect(FileLocationSchema.safeParse({ path: 'a.ts', ...position }).success).toBe(false);
    }
});
