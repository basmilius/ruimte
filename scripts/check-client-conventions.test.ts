import { describe, expect, test } from 'bun:test';
import { clientProblems, conventionProblems, topLevelArrows } from './check-client-conventions.ts';

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

    test('refuses a component that reaches sessions through the module-level client', () => {
        const text = "import { sessionClient } from '@/terminal';";

        expect(conventionProblems('apps/client/src/Panel.tsx', text)).toEqual([
            "apps/client/src/Panel.tsx: reach sessions and chats through the component's machine"
        ]);
        expect(conventionProblems('apps/client/src/panel.ts', text)).toEqual([]);
    });
});

describe('clientProblems', () => {
    const problemsIn = (path: string, text: string): string[] => clientProblems([{ path, text }]);

    test('refuses a window key listener outside the shortcut modules', () => {
        const text = "window.addEventListener('keydown', () => {});";

        expect(problemsIn('apps/client/src/Panel.tsx', text)).toEqual([
            'apps/client/src/Panel.tsx: a key is heard on the window only where a shortcut may be bound'
        ]);
        expect(problemsIn('apps/client/src/shell/app-shortcuts.ts', text)).toEqual([]);
    });

    test('refuses a raw color except where it is paint', () => {
        const text = "const stroke = '#ff00aa';";

        expect(problemsIn('apps/client/src/Panel.tsx', text)).toEqual([
            'apps/client/src/Panel.tsx:1: a color is a token of the theme, never a raw value in a component'
        ]);
        expect(problemsIn('apps/client/src/code-themes.ts', text)).toEqual([]);
    });

    test('refuses an Intl formatter except the speech model date', () => {
        const text = 'new Intl.DateTimeFormat();';

        expect(problemsIn('apps/client/src/Panel.tsx', text)).toEqual(['apps/client/src/Panel.tsx:1: only format/ builds a formatter out of Intl']);
        expect(problemsIn('apps/client/src/voice/controller.ts', text)).toEqual([]);
    });

    test('refuses a title, a bracketed type size and a fractional pixel', () => {
        const text = '<button title="Run" className="text-[13px] w-[1.5px]" />';

        expect(problemsIn('apps/client/src/Panel.tsx', text)).toHaveLength(3);
    });

    test('leaves the rules of ADE CORE that the client does not state alone', () => {
        expect(problemsIn('apps/client/src/Panel.tsx', '<span className="uppercase focus-visible:ring-2"><Icon size={18} /></span>')).toEqual([]);
    });

    test('adds the arrow rule of the client', () => {
        expect(problemsIn('apps/client/src/panel.ts', 'const clamp = () => 1;')).toEqual([
            'apps/client/src/panel.ts:1: declare clamp as a function, not a const bound to an arrow'
        ]);
    });
});
