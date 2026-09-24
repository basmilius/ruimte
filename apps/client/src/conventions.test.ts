import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';
import { parseSync, Visitor, type ImportExpression, type JSXElement, type JSXElementName, type JSXFragment, type Program } from 'oxc-parser';

const HERE = new URL('.', import.meta.url).pathname;

const sources = (): { path: string; text: string }[] =>
    [...new Glob('**/*.{ts,tsx}').scanSync(HERE)]
        .filter((path) => !path.endsWith('.test.ts'))
        .sort()
        .map((path) => ({ path, text: readFileSync(join(HERE, path), 'utf8') }));

type Tree = JSXElement | JSXFragment;

const programs = new Map<string, Program>();

const programOf = (path: string, text?: string): Program => {
    let program = programs.get(path);
    if (program === undefined) {
        program = parseSync(path, text ?? readFileSync(join(HERE, path), 'utf8')).program;
        programs.set(path, program);
    }
    return program;
};

const lineOf = (text: string, offset: number): number => text.slice(0, offset).split('\n').length;

/* Where a key may be heard on the window, and why there. */
const KEY_LISTENERS: Record<string, string> = {
    'shell/app-shortcuts.ts': "the window's own shortcuts, bound once",
    'canvas/canvas-shortcuts.ts': 'what acts on the project, bound once by the workspace',
    'drawing/use-drawing-keys.ts': "a drawing view's bare tool keys, the one exception the product rules allow, and only while that drawing has the keyboard",
    'ui/ShortcutHints.tsx': 'mounted once, and only watches a modifier held on its own; it binds no shortcut',
    'ui/modality.ts': 'started once, and only notes that the keyboard is in use; it binds no shortcut'
};

/* Where `Intl` may be used outside `src/format`, and why there. */
const INTL_OUTSIDE_FORMAT: Record<string, string> = {
    'voice/controller.ts': 'the date told to the speech model, fixed to en-GB so the model always reads one format; no person reads it'
};

/* Where `title` is not a hint but the element's accessible name, which a Tooltip does not give. */
const TITLE_AS_NAME = new Set(['iframe']);

/*
 * What may stand in App or WorkspaceShell without a boundary of its own, and why. A surface that
 * draws one inside its own module passes without being listed here.
 */
const UNGUARDED: Record<string, string> = {
    WindowContent: 'the window itself, under the last resort: the start screen has no page to lose, and a workspace guards each of its own surfaces'
};

const nameOf = (name: JSXElementName): string => {
    switch (name.type) {
        case 'JSXIdentifier':
            return name.name;
        case 'JSXNamespacedName':
            return `${name.namespace.name}:${name.name.name}`;
        case 'JSXMemberExpression':
            return `${nameOf(name.object)}.${name.property.name}`;
    }
};

/* The outermost elements inside an expression, such as the one in `{open && <Dialog />}`. */
const elementsIn = (node: unknown): Tree[] => {
    if (Array.isArray(node)) {
        return node.flatMap(elementsIn);
    }
    if (node === null || typeof node !== 'object' || !('type' in node)) {
        return [];
    }
    if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
        return [node as Tree];
    }
    return Object.entries(node).flatMap(([key, value]) => (key === 'parent' ? [] : elementsIn(value)));
};

/*
 * Every component a tree draws, and whether a boundary holds it alone. A DOM element, a provider or a
 * Suspense draws nothing of its own, so what is inside it is looked at instead.
 */
const surfacesIn = (node: Tree, guarded: boolean): { name: string; guarded: boolean }[] => {
    const children = elementsIn(node.children);
    if (node.type === 'JSXFragment') {
        return children.flatMap((child) => surfacesIn(child, false));
    }
    const name = nameOf(node.openingElement.name);
    if (name === 'ErrorBoundary') {
        return children.flatMap((child) => surfacesIn(child, children.length === 1));
    }
    if (/^[a-z]/.test(name) || name === 'Suspense' || name.endsWith('Provider')) {
        return children.flatMap((child) => surfacesIn(child, false));
    }
    return [{ name, guarded }];
};

/* What a component returns, from the statements of its own body and not from a function inside it. */
const returnedBy = (program: Program, component: string): Tree[] =>
    program.body.flatMap((statement) => {
        const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
        if (declaration?.type !== 'FunctionDeclaration' || declaration.id?.name !== component || !declaration.body) {
            return [];
        }
        return declaration.body.body.flatMap((inner) => (inner.type === 'ReturnStatement' ? elementsIn(inner.argument) : []));
    });

/* Every node under one, in the order of the source. */
const nodesIn = (node: unknown): { type: string }[] => {
    if (Array.isArray(node)) {
        return node.flatMap(nodesIn);
    }
    if (node === null || typeof node !== 'object') {
        return [];
    }
    const children = Object.entries(node).flatMap(([key, value]) => (key === 'parent' ? [] : nodesIn(value)));
    return 'type' in node && typeof node.type === 'string' ? [node as { type: string }, ...children] : children;
};

/* The file a component is imported from, statically or through a lazy `import()`. */
const moduleOf = (program: Program, component: string): string | null => {
    const sourceOf = (): unknown => {
        for (const statement of program.body) {
            if (statement.type === 'ImportDeclaration' && statement.specifiers.some((specifier) => specifier.local.name === component)) {
                return statement.source.value;
            }
            if (statement.type !== 'VariableDeclaration') {
                continue;
            }
            const declarator = statement.declarations.find((candidate) => candidate.id.type === 'Identifier' && candidate.id.name === component);
            const lazy = nodesIn(declarator?.init).find((candidate): candidate is ImportExpression => candidate.type === 'ImportExpression');
            if (lazy !== undefined) {
                return lazy.source.type === 'Literal' ? lazy.source.value : null;
            }
        }
        return null;
    };
    const source = sourceOf();
    if (typeof source !== 'string' || !source.startsWith('@/')) {
        return null;
    }
    return [`${source.slice(2)}.tsx`, `${source.slice(2)}.ts`].find((path) => existsSync(join(HERE, path))) ?? null;
};

const drawsBoundary = (path: string): boolean => {
    let found = false;
    new Visitor({
        JSXOpeningElement(node) {
            found ||= nameOf(node.name) === 'ErrorBoundary';
        }
    }).visit(programOf(path));
    return found;
};

/* The window's own tree and the workspace's, which is where a failure would reach every parked page. */
const SHELLS = [
    ['App.tsx', 'App'],
    ['shell/WorkspaceShell.tsx', 'WorkspaceShell']
] as const;

const surfacesOf = (path: string, component: string): { name: string; guarded: boolean }[] =>
    returnedBy(programOf(path), component).flatMap((root) => surfacesIn(root, false));

describe('the conventions of the client', () => {
    test('a key is heard on the window only where a shortcut may be bound', () => {
        const listening = sources()
            .filter(({ text }) => /(window|document)\.addEventListener\(\s*['"]key(down|up)['"]/.test(text))
            .map(({ path }) => path);
        expect(listening.filter((path) => !(path in KEY_LISTENERS))).toEqual([]);
    });

    test('type comes in the four sizes of the theme, never a size in brackets', () => {
        const bracketed = sources().flatMap(({ path, text }) => [...text.matchAll(/text-\[\d[^\]]*\]/g)].map((match) => `${path}: ${match[0]}`));
        expect(bracketed).toEqual([]);
    });

    test('a hint is a Tooltip, never a title on an element', () => {
        const titled = sources()
            .filter(({ path }) => path.endsWith('.tsx'))
            .flatMap(({ path, text }) => {
                const found: string[] = [];
                new Visitor({
                    JSXOpeningElement(node) {
                        const intrinsic = node.name.type === 'JSXIdentifier' && /^[a-z]/.test(node.name.name) && !TITLE_AS_NAME.has(node.name.name);
                        if (
                            intrinsic &&
                            node.attributes.some(
                                (attribute) => attribute.type === 'JSXAttribute' && attribute.name.type === 'JSXIdentifier' && attribute.name.name === 'title'
                            )
                        ) {
                            found.push(`${path}:${lineOf(text, node.start)}`);
                        }
                    }
                }).visit(programOf(path, text));
                return found;
            });
        expect(titled).toEqual([]);
    });

    test('only src/format builds a formatter out of Intl', () => {
        const building = sources()
            .filter(({ path }) => !path.startsWith('format/') && !(path in INTL_OUTSIDE_FORMAT))
            .flatMap(({ path, text }) => {
                const found: string[] = [];
                new Visitor({
                    MemberExpression(node) {
                        if (node.object.type === 'Identifier' && node.object.name === 'Intl') {
                            found.push(`${path}:${lineOf(text, node.start)}`);
                        }
                    }
                }).visit(programOf(path, text));
                return found;
            });
        expect(building).toEqual([]);
    });

    test.each(SHELLS)('every surface %s draws sits in an ErrorBoundary of its own', (path, component) => {
        const surfaces = surfacesOf(path, component);
        // A tree the scan could not find would pass with nothing in it.
        expect(surfaces.length).toBeGreaterThan(5);
        const bare = surfaces.filter(({ name, guarded }) => {
            if (guarded || name in UNGUARDED) {
                return false;
            }
            const module = moduleOf(programOf(path), name);
            return module === null || !drawsBoundary(module);
        });
        expect(bare.map(({ name }) => name)).toEqual([]);
    });

    test('every surface allowed without a boundary is still drawn without one', () => {
        const bare = SHELLS.flatMap(([path, component]) => surfacesOf(path, component))
            .filter(({ guarded }) => !guarded)
            .map(({ name }) => name);
        expect(Object.keys(UNGUARDED).filter((name) => !bare.includes(name))).toEqual([]);
    });
});
