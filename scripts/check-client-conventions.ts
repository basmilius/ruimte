import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync, Visitor } from 'oxc-parser';

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

const KEY_LISTENERS = new Set([
    'apps/client/src/shell/app-shortcuts.ts',
    'apps/client/src/canvas/canvas-shortcuts.ts',
    'apps/client/src/drawing/use-drawing-keys.ts'
]);

// The speech model needs a fixed date format; no person reads it.
const INTL_OUTSIDE_FORMAT = new Set(['apps/client/src/voice/controller.ts']);

// The places a color is written down as paint rather than read from a token: the syntax palettes, the
// accents a person and an agent pick from (xterm reads them as literals), and scenes drawn in WebGL or a
// canvas that no theme reaches, the pets' pixel art among them. The contrast math measures colors against
// the theme's two grounds and the two texts it can print on an accent, which only exist as values here.
const COLOR_LITERALS = new Set([
    'apps/client/src/shell/panels/code-themes.ts',
    'apps/client/src/state/accent-contrast.ts',
    'apps/client/src/canvas/accents.ts',
    'apps/client/src/ui/EclipseStars.tsx',
    'apps/client/src/ui/galaxy/Galaxy.tsx',
    'apps/client/src/measure/scene.ts',
    'extensions/pets/client/sprite-colors.ts',
    'extensions/pets/client/catalog.ts',
    'extensions/pets/client/sketches.ts'
]);
// A hex color, or a color function given numbers rather than a token, anywhere in a string.
const COLOR_LITERAL = /(?:^|[\s[(:,'"])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![0-9a-z])|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*[\d.]/i;

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

/* What a file of the client breaks of the rules above, one line per problem. */
export function conventionProblems(path: string, text: string): string[] {
    const problems: string[] = [];
    if (/(window|document)\.addEventListener\(\s*['"]key(down|up)['"]/.test(text) && !KEY_LISTENERS.has(path)) {
        problems.push(`${path}: bind window shortcuts in the designated shortcut modules`);
    }
    // Cleanup after a machine switch must still reach the original machine.
    if (path.endsWith('.tsx') && /import\s*\{[^}]*\b(sessionClient|chatClient)\b[^}]*\}\s*from\s*'@\/(terminal|transport\/connections)'/.test(text)) {
        problems.push(`${path}: reach sessions and chats through the component's machine`);
    }
    const program = parseSync(path, text).program;
    const lineOf = (start: number): number => text.slice(0, start).split('\n').length;
    if (!COLOR_LITERALS.has(path)) {
        new Visitor({
            Literal(node) {
                if (typeof node.value === 'string' && COLOR_LITERAL.test(node.value)) {
                    problems.push(`${path}:${lineOf(node.start)}: use a semantic token, not a raw color`);
                }
            },
            TemplateElement(node) {
                if (COLOR_LITERAL.test(node.value.raw)) {
                    problems.push(`${path}:${lineOf(node.start)}: use a semantic token, not a raw color`);
                }
            }
        }).visit(program);
    }
    if (!INTL_OUTSIDE_FORMAT.has(path)) {
        new Visitor({
            MemberExpression(node) {
                if (node.object.type === 'Identifier' && node.object.name === 'Intl') {
                    problems.push(`${path}:${lineOf(node.start)}: use @adecore/ui/format`);
                }
            }
        }).visit(program);
    }
    for (const arrow of topLevelArrows(path, text)) {
        problems.push(`${path}:${arrow.line}: declare ${arrow.name} as a function, not a const bound to an arrow`);
    }
    return problems;
}

if (import.meta.main) {
    const problems = clientSources().flatMap(({ path, text }) => conventionProblems(path, text));
    for (const problem of problems) {
        console.error(problem);
    }
    process.exitCode = problems.length === 0 ? 0 : 1;
}
