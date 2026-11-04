import { describe, expect, test } from 'bun:test';
import { conventionProblems, topLevelArrows } from './check-client-conventions.ts';

function namesIn(text: string): string[] {
    return topLevelArrows('example.ts', text).map((arrow) => arrow.name);
}

describe('topLevelArrows', () => {
    test('finds a top-level const bound to an arrow or function expression, exported or not', () => {
        const text = [
            'const clamp = (value: number) => value;',
            'export const at = (line: number) => ({ line });',
            'const handler = function () {};',
            'const wrapped = (async () => undefined);'
        ].join('\n');

        expect(topLevelArrows('example.ts', text)).toEqual([
            { line: 1, name: 'clamp' },
            { line: 2, name: 'at' },
            { line: 3, name: 'handler' },
            { line: 4, name: 'wrapped' }
        ]);
    });

    test('lets a function a factory or wrapper returns stay a const', () => {
        expect(namesIn('const Panel = lazyNamed(() => import("./Panel"), "Panel"); const debounced = debounce(() => undefined, 50);')).toEqual([]);
    });

    test('leaves an arrow inside a function, a let and a function declaration alone', () => {
        expect(namesIn('function outer() { const inner = () => 1; return inner; } let slot = () => 1; function named() {}')).toEqual([]);
    });

    test('leaves a destructured binding and a value that is no function alone', () => {
        expect(namesIn('const { a } = { a: () => 1 }; const LIMIT = 3; const table = { run: () => 1 };')).toEqual([]);
    });
});

describe('conventionProblems', () => {
    test('names the arrow with its line', () => {
        expect(conventionProblems('apps/client/src/example.ts', '\nconst clamp = () => 1;\n')).toEqual([
            'apps/client/src/example.ts:2: declare clamp as a function, not a const bound to an arrow'
        ]);
    });
});
