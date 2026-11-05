import { describe, expect, test } from 'bun:test';
import { rankFiles } from './search.ts';

describe('rankFiles', () => {
    test('needs every character in order and ignores case', () => {
        expect(rankFiles(['src/chat/Composer.ts'], 'cmp', 1)).toEqual(['src/chat/Composer.ts']);
        expect(rankFiles(['src/chat/composer.ts'], 'pmc', 1)).toEqual([]);
    });

    test('prefers the file name over a directory hit and a prefix over a scattered match', () => {
        expect(rankFiles(['chat/x.ts', 'src/chat.ts', 'src/changes/hat.ts'], 'chat', 3)).toEqual(['src/chat.ts', 'chat/x.ts', 'src/changes/hat.ts']);
    });

    test('matches words apart on their own and in any order', () => {
        const path = 'app-alpha/src/greeting.ts';
        expect(rankFiles([path], 'alpha greeting', 1)).toEqual([path]);
        expect(rankFiles([path], 'greeting  alpha', 1)).toEqual([path]);
        expect(rankFiles([path], 'alpha farewell', 1)).toEqual([]);
        expect(rankFiles([path], ' greeting ', 1)).toEqual([path]);
    });

    test('still prefers the file name for a word of a query with several', () => {
        const files = ['app-alpha/greeting/notes.ts', 'app-alpha/src/greeting.ts', 'app-alpha/src/farewell.ts'];
        expect(rankFiles(files, 'alpha greeting', 3)).toEqual(['app-alpha/src/greeting.ts', 'app-alpha/greeting/notes.ts']);
    });

    test('rankFiles keeps the limit and breaks ties on length', () => {
        expect(rankFiles(['b/index.ts', 'index.ts', 'a/index.ts'], '', 2)).toEqual(['index.ts', 'a/index.ts']);
    });

    test('limited ranking keeps tracked files ahead of ignored ties and returns every remaining match in order', () => {
        const files = ['file-h.ts', 'file-c.ts', 'file-f.ts', 'file-a.ts', 'file-g.ts', 'file-d.ts', 'file-b.ts', 'file-e.ts'];
        const ignored = ['file-2.ts', 'file-0.ts', 'file-1.ts'];
        const ordered = [
            'file-a.ts',
            'file-b.ts',
            'file-c.ts',
            'file-d.ts',
            'file-e.ts',
            'file-f.ts',
            'file-g.ts',
            'file-h.ts',
            'file-0.ts',
            'file-1.ts',
            'file-2.ts'
        ];
        for (const limit of [0, 1, 3, 8, 9, 20]) {
            expect(rankFiles(files, 'file', limit, ignored)).toEqual(ordered.slice(0, limit));
        }
    });
});
