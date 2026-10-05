import { describe, expect, test } from 'bun:test';
import { functionSourceAt, isFunctionSignature } from './explain-model';

describe('isFunctionSignature', () => {
    test('knows a function or method signature from a plain value', () => {
        for (const signature of [
            'function skillOverlap(have: string[], need: string[]): number',
            '(method) Cart.total(): number',
            'const run: () => void',
            'public function save(array $data): bool',
            'def parse(text: str) -> int',
            'func Open(name string) (*File, error)',
            'fn parse(text: &str) -> usize'
        ]) {
            expect(isFunctionSignature(signature)).toBe(true);
        }
        for (const signature of ['const weights: Weights', 'let count: number', 'class Cart', '(property) name: string']) {
            expect(isFunctionSignature(signature)).toBe(false);
        }
    });
});

describe('functionSourceAt', () => {
    const text = [
        'const before = 1;',
        'export function total(items: Item[]): number {',
        '    const text = "}";',
        '    if (items.length === 0) {',
        '        return 0;',
        '    }',
        '    return items.length;',
        '}',
        'const after = 2;'
    ].join('\n');

    test('stops at the brace that closes the body, ignoring braces in strings', () => {
        expect(functionSourceAt(text, 1).split('\n')).toHaveLength(7);
        expect(functionSourceAt(text, 1).endsWith('}')).toBe(true);
    });

    test('follows the brace on the next line, as PHP writes it', () => {
        const php = 'public function save()\n{\n    return 1;\n}\n\nother();';
        expect(functionSourceAt(php, 0)).toBe('public function save()\n{\n    return 1;\n}');
    });

    test('follows indentation for a language that goes by it', () => {
        const python = 'def parse(text):\n    value = int(text)\n    return value\n\nprint(parse("1"))';
        expect(functionSourceAt(python, 0)).toBe('def parse(text):\n    value = int(text)\n    return value');
    });

    test('takes an arrow function with no body to the end of its statement', () => {
        expect(functionSourceAt('const double = (value) =>\n    value * 2;\nconst next = 1;', 0)).toBe('const double = (value) =>\n    value * 2;');
    });

    test('is empty past the end of the file', () => {
        expect(functionSourceAt('a', 4)).toBe('');
    });
});
