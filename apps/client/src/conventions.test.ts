import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';
import { parseSync, Visitor, type ImportExpression, type JSXElement, type JSXElementName, type JSXFragment, type Program } from 'oxc-parser';

const HERE = new URL('.', import.meta.url).pathname;

/* The components the client draws with, held to the same rules; their files read as `@ruimte/ui/<file>`. */
const UI_PREFIX = '@ruimte/ui/';
const UI_SOURCE = join(HERE, '../../../packages/ui/src');

const fileOf = (path: string): string => (path.startsWith(UI_PREFIX) ? join(UI_SOURCE, path.slice(UI_PREFIX.length)) : join(HERE, path));

const sources = (): { path: string; text: string }[] =>
    [...new Glob('**/*.{ts,tsx}').scanSync(HERE), ...[...new Glob('*.{ts,tsx}').scanSync(UI_SOURCE)].map((path) => `${UI_PREFIX}${path}`)]
        .filter((path) => !path.endsWith('.test.ts'))
        .sort()
        .map((path) => ({ path, text: readFileSync(fileOf(path), 'utf8') }));

type Tree = JSXElement | JSXFragment;

const programs = new Map<string, Program>();

const programOf = (path: string, text?: string): Program => {
    let program = programs.get(path);
    if (program === undefined) {
        program = parseSync(path, text ?? readFileSync(fileOf(path), 'utf8')).program;
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
    '@ruimte/ui/ShortcutHints.tsx': 'mounted once, and only watches a modifier held on its own; it binds no shortcut',
    '@ruimte/ui/modality.ts': 'started once, and only notes that the keyboard is in use; it binds no shortcut'
};

/* Where `Intl` may be used outside `src/format`, and why there. */
const INTL_OUTSIDE_FORMAT: Record<string, string> = {
    'voice/controller.ts': 'the date told to the speech model, fixed to en-GB so the model always reads one format; no person reads it'
};

/* Where text may be set in capitals, and why there. A label anywhere else is a sentence, through `SECTION_LABEL`. */
const UPPERCASE: Record<string, string> = {
    'shell/LinkMachineDialog.tsx': 'the pairing code, which reads in capitals on the screen it is copied from, whatever case is typed'
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

/* Every class a `className` can carry, from a plain string, a template or the arguments of `clsx`. */
const classesIn = (value: unknown): string =>
    nodesIn(value)
        .flatMap((node) => {
            if (node.type === 'Literal' && 'value' in node && typeof node.value === 'string') {
                return [node.value];
            }
            if (node.type === 'TemplateElement' && 'value' in node) {
                return [(node.value as { cooked: string }).cooked];
            }
            return [];
        })
        .join(' ');

/* A segment of a control or a row that toggles says what it is with one of these, and a row of a list
   with its left-aligned text; neither is a Button. */
const ROW_ATTRIBUTES = new Set(['role', 'aria-pressed', 'aria-checked']);

/* An icon button takes its size, and with it its radius, from a modifier in `styles.css`. `w-auto` is
   the one way it widens, for a label beside its icon. */
const ICON_BUTTON_SIZE = /^(?:h|w|size|min-h|min-w|max-h|max-w)-(?!auto$)|^rounded/;

/* The icon each size of icon button draws, by the modifier on it; no modifier is the default of 32. */
const ICON_IN_BUTTON: Record<string, number> = { 'icon-btn-sm': 14, 'icon-btn-xs': 12, 'icon-btn-2xs': 12 };

/* Sizes between the steps of 12, 14, 16 and 20, which is what an icon anywhere keeps to. */
const OFF_SCALE_ICON = new Set([13, 15, 17, 18]);

const isIconButton = (classes: string): boolean => classes.split(/\s+/).includes('icon-btn');

const attributeOf = (node: JSXElement, name: string): unknown =>
    node.openingElement.attributes.find(
        (attribute) => attribute.type === 'JSXAttribute' && attribute.name.type === 'JSXIdentifier' && attribute.name.name === name
    );

const classesOf = (node: JSXElement): string => {
    const attribute = attributeOf(node, 'className') as { value: unknown } | undefined;
    return classesIn(attribute?.value);
};

/* The size an icon is drawn at, when the source says it as a number: 16 when it says nothing, null when it is computed. */
const iconSizeOf = (node: JSXElement): number | null => {
    const attribute = attributeOf(node, 'size') as { value: unknown } | undefined;
    if (attribute === undefined) {
        return 16;
    }
    const value = attribute.value as { type: string; expression?: { type: string; value?: unknown } } | null;
    return value?.type === 'JSXExpressionContainer' && value.expression?.type === 'Literal' && typeof value.expression.value === 'number'
        ? value.expression.value
        : null;
};

/* The icons a button draws itself, not those of a button inside it. */
const iconsIn = (node: Tree): JSXElement[] =>
    elementsIn(node.children).flatMap((child) => {
        if (child.type === 'JSXElement' && nameOf(child.openingElement.name) === 'Icon') {
            return [child];
        }
        if (child.type === 'JSXElement' && isIconButton(classesOf(child))) {
            return [];
        }
        return iconsIn(child);
    });

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

    test('a label is sentence case, never uppercase', () => {
        const shouted = sources()
            .filter(({ path }) => !(path in UPPERCASE))
            .flatMap(({ path, text }) =>
                nodesIn(programOf(path, text)).flatMap((node) => {
                    const classes = classesIn(node.type === 'Literal' || node.type === 'TemplateElement' ? [node] : []).split(/\s+/);
                    return classes.some((utility) => utility.slice(utility.lastIndexOf(':') + 1) === 'uppercase')
                        ? [`${path}:${lineOf(text, (node as unknown as { start: number }).start)}`]
                        : [];
                })
            );
        expect(shouted).toEqual([]);
    });

    test('keyboard focus is the accent outline, never a ring or a colored border', () => {
        const drawn = sources().flatMap(({ path, text }) =>
            [...text.matchAll(/focus(-visible|-within)?:(ring-|border-accent)/g)].map((match) => `${path}: ${match[0]}`)
        );
        expect(drawn).toEqual([]);
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

    test('a button with a word in it is a Button, never a height, a padding and a radius of its own', () => {
        const built = sources()
            .filter(({ path }) => path.endsWith('.tsx') && path !== '@ruimte/ui/Button.tsx')
            .flatMap(({ path, text }) => {
                const found: string[] = [];
                new Visitor({
                    JSXOpeningElement(node) {
                        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'button') {
                            return;
                        }
                        const attributes = node.attributes.flatMap((attribute) =>
                            attribute.type === 'JSXAttribute' && attribute.name.type === 'JSXIdentifier'
                                ? [{ name: attribute.name.name, value: attribute.value }]
                                : []
                        );
                        if (attributes.some(({ name }) => ROW_ATTRIBUTES.has(name))) {
                            return;
                        }
                        const classes = classesIn(attributes.find(({ name }) => name === 'className')?.value);
                        const exempt = /\b(icon-btn|w-\d+|menu-item|cursor-row|text-left)\b/.test(classes);
                        if (!exempt && /(^|\s)h-[678](\s|$)/.test(classes) && /\bpx-/.test(classes) && /\brounded-/.test(classes)) {
                            found.push(`${path}:${lineOf(text, node.start)}`);
                        }
                    }
                }).visit(programOf(path, text));
                return found;
            });
        expect(built).toEqual([]);
    });

    test('an icon button is sized by its modifier, never a height, a width or a radius of its own', () => {
        const sized = sources().flatMap(({ path, text }) =>
            nodesIn(programOf(path, text)).flatMap((node) => {
                const classes = classesIn(node.type === 'Literal' || node.type === 'TemplateElement' ? [node] : []);
                if (!isIconButton(classes)) {
                    return [];
                }
                const own = classes.split(/\s+/).filter((utility) => ICON_BUTTON_SIZE.test(utility.slice(utility.lastIndexOf(':') + 1)));
                return own.length > 0 ? [`${path}:${lineOf(text, (node as unknown as { start: number }).start)}: ${own.join(' ')}`] : [];
            })
        );
        expect(sized).toEqual([]);
    });

    test('an icon button draws the icon of its size', () => {
        const mismatched = sources()
            .filter(({ path }) => path.endsWith('.tsx'))
            .flatMap(({ path, text }) =>
                nodesIn(programOf(path, text)).flatMap((node) => {
                    if (node.type !== 'JSXElement') {
                        return [];
                    }
                    const button = node as JSXElement;
                    const classes = classesOf(button).split(/\s+/);
                    if (!classes.includes('icon-btn') || classes.includes('w-auto')) {
                        return [];
                    }
                    const modifiers = classes.filter((utility) => utility in ICON_IN_BUTTON);
                    // A size chosen at run time says so in a computed icon size, which is not read here.
                    if (modifiers.length > 1) {
                        return [];
                    }
                    const expected = modifiers.length === 1 ? ICON_IN_BUTTON[modifiers[0] as string] : 16;
                    return (
                        iconsIn(button)
                            // An icon laid over another drawing, such as the cross inside a toast's timer ring, is part of that drawing.
                            .filter((icon) => !classesOf(icon).split(/\s+/).includes('absolute'))
                            .filter((icon) => {
                                const size = iconSizeOf(icon);
                                return size !== null && size !== expected;
                            })
                            .map((icon) => `${path}:${lineOf(text, icon.start)}: ${iconSizeOf(icon)} in ${modifiers[0] ?? 'icon-btn'}`)
                    );
                })
            );
        expect(mismatched).toEqual([]);
    });

    test('an icon is 12, 14, 16 or 20 pixels, never a size between the steps', () => {
        const between = sources()
            .filter(({ path }) => path.endsWith('.tsx'))
            .flatMap(({ path, text }) =>
                nodesIn(programOf(path, text)).flatMap((node) => {
                    if (node.type !== 'JSXElement') {
                        return [];
                    }
                    const size = iconSizeOf(node as JSXElement);
                    return size !== null && OFF_SCALE_ICON.has(size) && attributeOf(node as JSXElement, 'size') !== undefined
                        ? [`${path}:${lineOf(text, (node as JSXElement).start)}: ${size}`]
                        : [];
                })
            );
        expect(between).toEqual([]);
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
