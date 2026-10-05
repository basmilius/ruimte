import { describe, expect, test } from 'bun:test';
import { dropMovesOf } from './file-rename';

describe('a drop in the files tree', () => {
    test('moves each dragged row into the folder it was dropped on', () => {
        expect(dropMovesOf('/repo', ['src/a.ts', 'docs/'], 'lib/')).toEqual([
            { from: '/repo/src/a.ts', to: '/repo/lib/a.ts' },
            { from: '/repo/docs', to: '/repo/lib/docs' }
        ]);
    });

    test('a drop on the project folder moves to the top', () => {
        expect(dropMovesOf('/repo', ['src/a.ts'], null)).toEqual([{ from: '/repo/src/a.ts', to: '/repo/a.ts' }]);
    });

    test('leaves out a row dropped where it is, a folder dropped into itself and a row its dragged folder takes along', () => {
        expect(dropMovesOf('/repo', ['src/a.ts'], 'src/')).toEqual([]);
        expect(dropMovesOf('/repo', ['src/'], 'src/')).toEqual([]);
        expect(dropMovesOf('/repo', ['src/'], 'src/deep/')).toEqual([]);
        expect(dropMovesOf('/repo', ['src/', 'src/a.ts', 'src/a.ts'], 'lib/')).toEqual([{ from: '/repo/src', to: '/repo/lib/src' }]);
    });

    test('a name that only starts like the folder is no part of it', () => {
        expect(dropMovesOf('/repo', ['src2/'], 'src/')).toEqual([{ from: '/repo/src2', to: '/repo/src/src2' }]);
    });
});
