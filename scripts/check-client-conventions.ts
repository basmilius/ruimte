import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { designProblemsIn, type DesignOptions } from '@adecore/ui/design-conventions';
import { parseSync } from 'oxc-parser';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// The pets are a built-in the client imports, so their client code is held to the client's rules.
const SOURCE_FOLDERS = ['apps/client/src', 'extensions/pets/client'];
function clientSources(): Array<{ path: string; text: string }> {
    return (
        SOURCE_FOLDERS.flatMap((folder) => [...new Glob(`${folder}/**/*.{ts,tsx}`).scanSync(ROOT)])
            // The rules below name files with forward slashes, which Windows does not hand back.
            .map((path) => path.replaceAll('\\', '/'))
            .filter((path) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'))
            .sort()
            .map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }))
    );
}

// The design rules of ADE CORE that the root CLAUDE.md states as well. Its other rules (uppercase labels,
// focus rings, icon sizes) are not Ruimte's: a model's badge is in capitals, and the pets draw their own focus.
export const DESIGN_OPTIONS: DesignOptions = {
    rules: ['keyListeners', 'typeSize', 'tooltip', 'intl', 'color', 'fractionalPixel'],
    keyListeners: ['apps/client/src/shell/app-shortcuts.ts', 'apps/client/src/shell/canvas-shortcuts.ts', 'apps/client/src/drawing/use-drawing-keys.ts'],
    // The speech model needs a fixed date format; no person reads it.
    intlExempt: ['apps/client/src/voice/controller.ts'],
    // The places a color is written down as paint rather than read from a token: the syntax palettes, the
    // accents a person and an agent pick from (xterm reads them as literals), and scenes drawn in WebGL or a
    // canvas that no theme reaches, the pets' pixel art among them.
    colorExempt: [
        'apps/client/src/code-themes.ts',
        'apps/client/src/canvas-model/accents.ts',
        'apps/client/src/ui/EclipseStars.tsx',
        'apps/client/src/ui/galaxy/Galaxy.tsx',
        'apps/client/src/measure/scene.ts',
        'extensions/pets/client/sprite-colors.ts',
        'extensions/pets/client/catalog.ts',
        'extensions/pets/client/sketches.ts'
    ]
};

export interface TopLevelArrow {
    line: number;
    name: string;
}

/*
 * Every top-level `const` bound straight to an arrow or function expression, which the root CLAUDE.md
 * wants as a function declaration. What a factory or a wrapper returns stays a `const`.
 */
export function topLevelArrows(path: string, text: string): TopLevelArrow[] {
    const found: TopLevelArrow[] = [];
    const lineOf = (start: number): number => text.slice(0, start).split('\n').length;

    for (const statement of parseSync(path, text).program.body) {
        const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;

        if (declaration?.type !== 'VariableDeclaration' || declaration.kind !== 'const') {
            continue;
        }

        for (const declarator of declaration.declarations) {
            let init = declarator.init;

            while (init?.type === 'ParenthesizedExpression') {
                init = init.expression;
            }

            if (declarator.id.type === 'Identifier' && (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression')) {
                found.push({ line: lineOf(declarator.start), name: declarator.id.name });
            }
        }
    }

    return found;
}

/* What a file of the client breaks of the rules that are Ruimte's alone, one line per problem. */
export function conventionProblems(path: string, text: string): string[] {
    const problems: string[] = [];
    // Cleanup after a machine switch must still reach the original machine.
    if (path.endsWith('.tsx') && /import\s*\{[^}]*\b(sessionClient|chatClient)\b[^}]*\}\s*from\s*'@\/(terminal|transport\/connections)'/.test(text)) {
        problems.push(`${path}: reach sessions and chats through the component's machine`);
    }
    for (const arrow of topLevelArrows(path, text)) {
        problems.push(`${path}:${arrow.line}: declare ${arrow.name} as a function, not a const bound to an arrow`);
    }
    return problems;
}

/* The design rules of ADE CORE that hold for the client, and then the rules of Ruimte's own. */
export function clientProblems(sources: Array<{ path: string; text: string }>): string[] {
    return [
        ...designProblemsIn(sources, DESIGN_OPTIONS).map(({ rule, location }) => `${location}: ${rule}`),
        ...sources.flatMap(({ path, text }) => conventionProblems(path, text))
    ];
}

if (import.meta.main) {
    const problems = clientProblems(clientSources());
    for (const problem of problems) {
        console.error(problem);
    }
    process.exitCode = problems.length === 0 ? 0 : 1;
}
