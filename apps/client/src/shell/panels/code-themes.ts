import type { ThemeRegistration } from 'shiki';

const THEME_ID = 'ruimte';
const THEME_NAME = 'Ruimte';

type CodeThemeMode = 'light' | 'dark';

/* A Shiki theme with what a picker needs to list it filled in. */
export type CodeTheme = ThemeRegistration & { readonly name: string; readonly displayName: string; readonly type: CodeThemeMode };

/* What a piece of code is, whatever the language; every scope below is drawn as one of these. */
export type CodeRole =
    | 'foreground'
    | 'keyword'
    | 'string'
    | 'escape'
    | 'number'
    | 'constant'
    | 'comment'
    | 'docComment'
    | 'docTag'
    | 'functionDeclaration'
    | 'functionCall'
    | 'builtin'
    | 'type'
    | 'variable'
    | 'parameter'
    | 'property'
    | 'operator'
    | 'punctuation'
    | 'decorator'
    | 'tag'
    | 'attribute'
    | 'entity'
    | 'label'
    | 'regex'
    | 'heading'
    | 'link'
    | 'inlineCode'
    | 'inserted'
    | 'deleted'
    | 'changed'
    | 'diffHeader';

export interface CodePalette {
    /* The code background of the side (`--term-bg` in `styles.css`), which `code-themes.test.ts` holds it to. */
    readonly background: string;
    readonly colors: Readonly<Record<CodeRole, string>>;
    readonly fontStyles: Readonly<Partial<Record<CodeRole, 'italic' | 'bold'>>>;
}

const LIGHT: CodePalette = {
    background: '#fbfbfc',
    colors: {
        foreground: '#080808',
        keyword: '#0033b3',
        string: '#067d17',
        escape: '#0037a6',
        number: '#1750eb',
        constant: '#871094',
        comment: '#8c8c8c',
        docComment: '#8c8c8c',
        docTag: '#8c8c8c',
        functionDeclaration: '#00627a',
        functionCall: '#080808',
        builtin: '#080808',
        type: '#000000',
        variable: '#000000',
        parameter: '#000000',
        property: '#871094',
        operator: '#080808',
        punctuation: '#080808',
        decorator: '#9e880d',
        tag: '#080808',
        attribute: '#174ad4',
        entity: '#174be6',
        label: '#080808',
        regex: '#264eff',
        heading: '#0033b3',
        link: '#006dcc',
        inlineCode: '#067d17',
        inserted: '#067d17',
        deleted: '#c62a3a',
        changed: '#00627a',
        diffHeader: '#0033b3'
    },
    fontStyles: { constant: 'italic', comment: 'italic', docComment: 'italic', docTag: 'italic', builtin: 'italic', heading: 'bold' }
};

const DARK: CodePalette = {
    background: '#08080a',
    colors: {
        foreground: '#bcbec4',
        keyword: '#cf8e6d',
        string: '#6aab73',
        escape: '#cf8e6d',
        number: '#2aacb8',
        constant: '#c77dbb',
        comment: '#7a7e85',
        docComment: '#5f826b',
        docTag: '#67a37c',
        functionDeclaration: '#56a8f5',
        functionCall: '#bcbec4',
        builtin: '#bcbec4',
        type: '#bcbec4',
        variable: '#bcbec4',
        parameter: '#bcbec4',
        property: '#c77dbb',
        operator: '#bcbec4',
        punctuation: '#bcbec4',
        decorator: '#b3ae60',
        tag: '#d5b778',
        attribute: '#bababa',
        entity: '#56a8f5',
        label: '#bcbec4',
        regex: '#42c3d4',
        heading: '#cf8e6d',
        link: '#56a8f5',
        inlineCode: '#6aab73',
        inserted: '#6aab73',
        deleted: '#fa6675',
        changed: '#56a8f5',
        diffHeader: '#cf8e6d'
    },
    fontStyles: { constant: 'italic', docComment: 'italic', docTag: 'italic', builtin: 'italic', label: 'bold', heading: 'bold' }
};

export const CODE_PALETTES: Readonly<Record<CodeThemeMode, CodePalette>> = { light: LIGHT, dark: DARK };

/*
 * Which scopes each role covers, for the grammars of TypeScript, JavaScript, Python, Rust, Go, PHP,
 * Swift, JSON, YAML, Markdown, CSS, SCSS, HTML, shell and diff. The order carries no weight: a
 * TextMate theme lets the longest matching scope win, and a selector with a parent beats the same
 * scope without one. The narrower entries lean on that, such as a property name in JSON leaving the
 * types it is filed under.
 */
const SCOPES: Readonly<Record<Exclude<CodeRole, 'foreground'>, readonly string[]>> = {
    comment: ['comment', 'punctuation.definition.comment', 'string.comment'],
    docComment: ['comment.block.documentation', 'comment.line.documentation', 'comment.line.triple-slash.documentation'],
    docTag: [
        'comment.block.documentation storage.type',
        'comment.block.documentation entity.name.type',
        'comment.block.documentation variable',
        'comment.block.documentation punctuation.definition.block.tag',
        'comment.block.documentation punctuation.definition.bracket',
        'storage.type.class.jsdoc',
        'keyword.other.phpdoc',
        'entity.name.type.instance.jsdoc',
        'variable.other.jsdoc'
    ],
    keyword: [
        'keyword',
        'storage.type',
        'storage.modifier',
        'variable.language',
        'keyword.operator.new',
        'keyword.operator.expression',
        'keyword.operator.word',
        'keyword.operator.logical.python',
        'punctuation.definition.template-expression',
        'punctuation.section.embedded',
        'punctuation.definition.interpolation',
        'punctuation.section.interpolation',
        'punctuation.definition.list.begin.markdown',
        'beginning.punctuation.definition.list.markdown'
    ],
    operator: ['keyword.operator', 'storage.type.function.arrow'],
    punctuation: ['punctuation', 'meta.brace', 'meta.delimiter', 'markup.quote', 'fenced_code.block.language'],
    string: ['string', 'punctuation.definition.string', 'string.unquoted.plain.out.yaml', 'string.unquoted.plain.in.yaml'],
    escape: ['constant.character.escape', 'constant.character.format.placeholder', 'constant.other.placeholder'],
    number: ['constant.numeric', 'keyword.other.unit'],
    constant: [
        'constant.language',
        'constant.character',
        'constant.other',
        'support.constant',
        'variable.other.constant',
        'variable.other.enummember',
        'entity.name.constant',
        'constant.other.option'
    ],
    functionDeclaration: ['entity.name.function'],
    functionCall: [
        'meta.function-call entity.name.function',
        'meta.function.call entity.name.function',
        'meta.method-call entity.name.function',
        'entity.name.function.support',
        'meta.function-call.generic',
        'variable.function',
        'support.function',
        'entity.name.function.macro',
        'support.macro',
        'entity.name.command'
    ],
    builtin: ['support.function.builtin', 'support.function.construct', 'support.class.builtin', 'support.class.console'],
    type: [
        'entity.name.type',
        'entity.name.class',
        'entity.name.namespace',
        'entity.name.module',
        'entity.name.package',
        'entity.other.inherited-class',
        'support.type',
        'support.class',
        'support.class.component',
        'storage.type.numeric.go',
        'storage.type.string.go',
        'storage.type.boolean.go',
        'storage.type.byte.go',
        'storage.type.rune.go',
        'storage.type.error.go',
        'storage.type.uintptr.go',
        'keyword.other.type.php',
        'support.other.namespace.php',
        'variable.other.alias.yaml'
    ],
    variable: [
        'variable',
        'variable.other.readwrite',
        'punctuation.definition.variable',
        'meta.definition.variable variable.other.constant',
        'meta.template.expression',
        'meta.embedded',
        'string meta.interpolation',
        'string variable',
        'string.unquoted.argument.shell',
        'string.unquoted.shell'
    ],
    parameter: ['variable.parameter'],
    property: [
        'variable.other.property',
        'variable.other.object.property',
        'support.variable.property',
        'meta.object-literal.key',
        'meta.attribute.python',
        'support.type.property-name',
        'entity.name.tag.yaml',
        'variable.other.member',
        'entity.name.variable.field',
        'variable.css'
    ],
    decorator: [
        'meta.decorator',
        'punctuation.decorator',
        'entity.name.function.decorator',
        'meta.decorator meta.function-call entity.name.function',
        'meta.decorator entity.name.function',
        'punctuation.definition.decorator',
        'meta.attribute.rust',
        'meta.attribute.rust punctuation',
        'meta.attribute.php',
        'support.attribute',
        'storage.type.attribute',
        'storage.modifier.attribute',
        'punctuation.definition.attribute'
    ],
    regex: [
        'string.regexp',
        'string.regexp punctuation.definition.string',
        'string.regexp keyword.other',
        'keyword.control.anchor.regexp',
        'keyword.operator.quantifier.regexp',
        'keyword.operator.or.regexp',
        'keyword.operator.negation.regexp',
        'punctuation.definition.group.regexp',
        'punctuation.definition.character-class.regexp',
        'constant.other.character-class.regexp',
        'constant.other.character-class.set.regexp'
    ],
    tag: ['entity.name.tag', 'meta.tag.sgml'],
    attribute: ['entity.other.attribute-name'],
    entity: ['constant.character.entity', 'punctuation.definition.entity.html'],
    label: ['entity.name.label', 'punctuation.definition.label'],
    heading: ['markup.heading', 'entity.name.section', 'punctuation.definition.heading'],
    link: ['markup.underline.link', 'markup.link', 'constant.other.reference.link', 'string.other.link'],
    inlineCode: ['markup.inline.raw', 'markup.raw.block'],
    inserted: ['markup.inserted', 'punctuation.definition.inserted'],
    deleted: ['markup.deleted', 'punctuation.definition.deleted'],
    changed: ['markup.changed', 'punctuation.definition.changed'],
    diffHeader: ['meta.diff.header', 'meta.diff.range', 'meta.diff.index', 'punctuation.definition.from-file', 'punctuation.definition.to-file']
};

type Rule = NonNullable<ThemeRegistration['tokenColors']>[number];

const tokenColors = (palette: CodePalette): Rule[] => [
    ...Object.entries(SCOPES).map(([role, scope]) => {
        const fontStyle = palette.fontStyles[role as CodeRole];
        return { scope: [...scope], settings: { foreground: palette.colors[role as CodeRole], ...(fontStyle === undefined ? {} : { fontStyle }) } };
    }),
    // Emphasis keeps the color of the text it is in.
    { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
    { scope: ['markup.italic'], settings: { fontStyle: 'italic' } }
];

const themeOf = (type: CodeThemeMode, palette: CodePalette): CodeTheme => ({
    name: `${THEME_ID}-${type}`,
    displayName: `${THEME_NAME} ${type === 'light' ? 'Light' : 'Dark'}`,
    type,
    fg: palette.colors.foreground,
    bg: palette.background,
    colors: {
        'editor.foreground': palette.colors.foreground,
        'editor.background': palette.background,
        // A diff draws its added, removed and changed lines in these.
        'gitDecoration.addedResourceForeground': palette.colors.inserted,
        'gitDecoration.deletedResourceForeground': palette.colors.deleted,
        'gitDecoration.modifiedResourceForeground': palette.colors.changed
    },
    tokenColors: tokenColors(palette)
});

/* Ruimte's own code themes, light first. Shiki takes them as they are, so they go wherever a bundled theme id does once resolved. */
export const CODE_THEMES: readonly CodeTheme[] = [themeOf('light', LIGHT), themeOf('dark', DARK)];

const ownCodeTheme = (id: string): CodeTheme | null => CODE_THEMES.find((theme) => theme.name === id) ?? null;

/* What to hand Shiki for a theme id: our theme itself, or the id of a bundled one for Shiki to load. */
export const shikiThemeOf = (id: string): string | ThemeRegistration => ownCodeTheme(id) ?? id;
