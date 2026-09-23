import { describe, expect, test } from 'bun:test';
import { modelPath, monacoLanguageOf, workerFor } from './languages.ts';

describe('monacoLanguageOf', () => {
    test('gives TypeScript its own grammar and TSX, JSX and JavaScript the TSX one', () => {
        expect(monacoLanguageOf('typescript')).toEqual({ id: 'typescript', grammar: 'typescript' });
        for (const id of ['tsx', 'jsx', 'javascript']) {
            expect(monacoLanguageOf(id)).toEqual({ id: 'javascript', grammar: 'tsx' });
        }
    });

    test('reads JSON with comments either way', () => {
        expect(monacoLanguageOf('json')).toEqual({ id: 'json', grammar: 'jsonc' });
        expect(monacoLanguageOf('jsonc')).toEqual({ id: 'json', grammar: 'jsonc' });
    });

    test('keeps every other Shiki id as it is', () => {
        expect(monacoLanguageOf('scss')).toEqual({ id: 'scss', grammar: 'scss' });
        expect(monacoLanguageOf('rust')).toEqual({ id: 'rust', grammar: 'rust' });
        expect(monacoLanguageOf('json5')).toEqual({ id: 'json5', grammar: 'json5' });
    });
});

describe('workerFor', () => {
    test('runs each language service in its own worker and the rest in the base one', () => {
        expect(workerFor('typescript')).toBe('typescript');
        expect(workerFor('javascript')).toBe('typescript');
        expect(workerFor('less')).toBe('css');
        expect(workerFor('json')).toBe('json');
        expect(workerFor('html')).toBe('html');
        expect(workerFor('editorWorkerService')).toBe('editor');
    });
});

describe('modelPath', () => {
    test('ends in the file, extension and all, under a segment per model', () => {
        expect(modelPath(3, '/repo/src/App.tsx')).toBe('/3/repo/src/App.tsx');
        expect(modelPath(4, '/repo/src/App.tsx')).toBe('/4/repo/src/App.tsx');
        expect(modelPath(5, 'notes.md')).toBe('/5/notes.md');
        expect(modelPath(6, undefined)).toBe('/6');
    });
});
