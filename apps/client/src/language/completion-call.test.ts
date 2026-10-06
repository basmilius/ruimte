import { describe, expect, test } from 'bun:test';
import type { CompletionItem } from '@adecore/lsp';
import { hasParameters, planCall, withParentheses, type CallSite } from '@adecore/editor-react/models';

const at = (line: number, character: number) => ({ line, character });
const method = (extra: Partial<CompletionItem> = {}): CompletionItem => ({ label: 'open', kind: 2, ...extra });

function site(extra: Partial<CallSite> = {}): CallSite {
    return {
        item: method(),
        languageId: 'typescript',
        insertion: { range: { start: at(0, 4), end: at(0, 6) }, text: 'open', stops: [] },
        before: 'box.',
        rest: '',
        replace: false,
        ...extra
    };
}

describe('hasParameters', () => {
    test('reads the list from the detail of a TypeScript item, past its kind in parentheses', () => {
        expect(hasParameters(method({ detail: '(method) Box.open(flag: boolean): void' }))).toBe(true);
        expect(hasParameters(method({ detail: '(method) Box.open(): void' }))).toBe(false);
        expect(hasParameters(method({ detail: '(method) Box<T>.map(cb: (item: T) => void): void' }))).toBe(true);
        expect(hasParameters(method({ detail: 'function now(  ): number' }))).toBe(false);
    });

    test('reads the list from the label details, which come before the detail', () => {
        expect(hasParameters(method({ labelDetails: { detail: '($a, $b)' }, detail: 'void' }))).toBe(true);
        expect(hasParameters(method({ labelDetails: { detail: '()' }, detail: 'void' }))).toBe(false);
        expect(hasParameters(method({ labelDetails: { detail: '(): void' } }))).toBe(false);
    });

    test('is unknown when the server names no list, and does not take an import line for one', () => {
        expect(hasParameters(method())).toBeNull();
        expect(hasParameters(method({ detail: 'void' }))).toBeNull();
        expect(hasParameters(method({ detail: 'use Raxos\\Orm\\open(' }))).toBeNull();
        expect(hasParameters(method({ detail: 'use Raxos\\Orm\\Box\n(method) Box.open(a): void' }))).toBe(true);
    });
});

describe('planCall', () => {
    test('adds parentheses to a function, a method and a constructor, inside unless the list is known to be empty', () => {
        expect(planCall(site())).toEqual({ action: 'add', inside: true });
        expect(planCall(site({ item: method({ kind: 3, detail: 'function open(): void' }) }))).toEqual({ action: 'add', inside: false });
        expect(planCall(site({ item: method({ kind: 4, detail: '(constructor) Box(size: number)' }) }))).toEqual({ action: 'add', inside: true });
    });

    test('leaves a variable, a property and a class alone, and a class after new gets them', () => {
        expect(planCall(site({ item: method({ kind: 6 }) }))).toEqual({ action: 'none' });
        expect(planCall(site({ item: method({ kind: 10 }) }))).toEqual({ action: 'none' });
        expect(planCall(site({ item: method({ kind: 7 }) }))).toEqual({ action: 'none' });
        expect(planCall(site({ item: method({ kind: 7 }), before: 'const box = new ' }))).toEqual({ action: 'add', inside: true });
    });

    test('leaves languages without calls of this shape alone', () => {
        expect(planCall(site({ languageId: 'shellscript' }))).toEqual({ action: 'none' });
        expect(planCall(site({ languageId: 'scss' }))).toEqual({ action: 'none' });
    });

    test('does not add what is already there: a snippet, text with a parenthesis, or a parenthesis that follows', () => {
        expect(planCall(site({ item: method({ insertTextFormat: 2 }) }))).toEqual({ action: 'none' });
        expect(planCall(site({ insertion: { range: { start: at(0, 4), end: at(0, 6) }, text: 'open(flag)', stops: [] } }))).toEqual({ action: 'none' });
        expect(planCall(site({ rest: '(1)' }))).toEqual({ action: 'none' });
        expect(planCall(site({ rest: '(1)', replace: true }))).toEqual({ action: 'enter', shift: 1 });
        expect(planCall(site({ rest: '  (1)', replace: true }))).toEqual({ action: 'enter', shift: 3 });
        expect(planCall(site({ rest: '<string>(1)' }))).toEqual({ action: 'none' });
    });

    test('adds none in an import or export list, one line or several, and none in a default export', () => {
        expect(planCall(site({ before: 'import { ' }))).toEqual({ action: 'none' });
        expect(planCall(site({ before: 'import def, { a,\n    ' }))).toEqual({ action: 'none' });
        expect(planCall(site({ before: 'import type { ' }))).toEqual({ action: 'none' });
        expect(planCall(site({ before: 'export { a, ' }))).toEqual({ action: 'none' });
        expect(planCall(site({ before: 'import box = ' }))).toEqual({ action: 'none' });
        expect(planCall(site({ before: 'export default ' }))).toEqual({ action: 'none' });
        expect(planCall(site({ before: 'import { a } from "x";\nconst box = { b: 1 }\nbox.' }))).toEqual({ action: 'add', inside: true });
        expect(planCall(site({ before: 'function f() {\n    box.' }))).toEqual({ action: 'add', inside: true });
        expect(planCall(site({ before: 'export const config = { ' }))).toEqual({ action: 'add', inside: true });
    });

    test('adds none where the name is not called: after typeof and the like, and in a tag', () => {
        expect(planCall(site({ before: 'type Open = typeof box.' }))).toEqual({ action: 'none' });
        expect(planCall(site({ before: 'if (a instanceof ' }))).toEqual({ action: 'none' });
        expect(planCall(site({ before: 'const a = b as ' }))).toEqual({ action: 'none' });
        expect(planCall(site({ languageId: 'typescriptreact', before: 'return <' }))).toEqual({ action: 'none' });
        expect(planCall(site({ languageId: 'vue', before: '<template><ui.' }))).toEqual({ action: 'none' });
        expect(planCall(site({ languageId: 'typescript', before: 'if (a <' }))).toEqual({ action: 'add', inside: true });
        expect(planCall(site({ languageId: 'typescriptreact', before: 'if (a < ' }))).toEqual({ action: 'add', inside: true });
    });

    test('adds none in a PHP use statement, group use or attribute, and Python import', () => {
        const php = (before: string, extra: Partial<CallSite> = {}) => planCall(site({ languageId: 'php', before, ...extra }));
        expect(php('use function Raxos\\')).toEqual({ action: 'none' });
        expect(php('use Raxos\\{Foo, ', { item: method({ kind: 3 }) })).toEqual({ action: 'none' });
        expect(php('#[', { item: method({ kind: 4 }) })).toEqual({ action: 'none' });
        expect(php('$box->')).toEqual({ action: 'add', inside: true });
        expect(planCall(site({ languageId: 'python', before: 'from box import ' }))).toEqual({ action: 'none' });
        expect(planCall(site({ languageId: 'python', before: 'import ' }))).toEqual({ action: 'none' });
        expect(planCall(site({ languageId: 'python', before: 'box.' }))).toEqual({ action: 'add', inside: true });
    });
});

describe('withParentheses', () => {
    test('puts the one stop inside the parentheses, or behind them', () => {
        const insertion = { range: { start: at(0, 4), end: at(0, 6) }, text: 'open', stops: [] };
        expect(withParentheses(insertion, true)).toEqual({ ...insertion, text: 'open()', stops: [{ index: 0, start: 5, end: 5 }] });
        expect(withParentheses(insertion, false)).toEqual({ ...insertion, text: 'open()', stops: [{ index: 0, start: 6, end: 6 }] });
    });
});
