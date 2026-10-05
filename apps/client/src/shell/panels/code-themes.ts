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
    | 'docTagValue'
    | 'functionDeclaration'
    | 'functionCall'
    | 'builtin'
    | 'type'
    | 'variable'
    | 'parameter'
    | 'localVariable'
    | 'phpVariable'
    | 'phpConstant'
    | 'typeParameter'
    | 'property'
    | 'staticProperty'
    | 'call'
    | 'staticCall'
    | 'methodCall'
    | 'operator'
    | 'punctuation'
    | 'decorator'
    | 'tag'
    | 'tagPunctuation'
    | 'customTag'
    | 'attribute'
    | 'entity'
    | 'color'
    | 'anchor'
    | 'label'
    | 'regex'
    | 'heading'
    | 'link'
    | 'linkDestination'
    | 'inlineCode'
    | 'inserted'
    | 'deleted'
    | 'changed'
    | 'diffHeader';

export interface CodePalette {
    /* The ground a chat draws code on (`--term-bg` of `@adecore/terminal/terminal.css`). A panel draws code on its own `--surface`, and `code-themes.test.ts` holds every role readable on both. */
    readonly background: string;
    readonly colors: Readonly<Record<CodeRole, string>>;
    readonly fontStyles: Readonly<Partial<Record<CodeRole, 'italic' | 'bold'>>>;
}

/*
 * The colors of the platform's default color schemes, Islands Dark and its light counterpart, resolved
 * with what the language plugins add (PHP, JavaScript and TypeScript, CSS, YAML, Markdown). Three
 * stand a step off the scheme so they read on both grounds: the type parameter of the dark side
 * (#507874) and the local variable (#2a8c7c) and type parameter (#20999d) of the light side.
 */
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
        docTagValue: '#3d3d3d',
        functionDeclaration: '#00627a',
        functionCall: '#080808',
        builtin: '#080808',
        type: '#000000',
        variable: '#000000',
        parameter: '#000000',
        localVariable: '#278172',
        phpVariable: '#660000',
        phpConstant: '#871094',
        typeParameter: '#1b8084',
        property: '#871094',
        staticProperty: '#871094',
        call: '#00627a',
        staticCall: '#00627a',
        methodCall: '#914c07',
        operator: '#080808',
        punctuation: '#080808',
        decorator: '#9e880d',
        tag: '#0033b3',
        tagPunctuation: '#080808',
        customTag: '#0033b3',
        attribute: '#174ad4',
        entity: '#174be6',
        color: '#0033b3',
        anchor: '#0000e6',
        label: '#080808',
        regex: '#264eff',
        heading: '#871094',
        link: '#006dcc',
        linkDestination: '#00627a',
        inlineCode: '#080808',
        inserted: '#067d17',
        deleted: '#c62a3a',
        changed: '#00627a',
        diffHeader: '#0033b3'
    },
    fontStyles: {
        constant: 'italic',
        comment: 'italic',
        docComment: 'italic',
        docTagValue: 'italic',
        builtin: 'italic',
        phpConstant: 'italic',
        staticProperty: 'italic',
        staticCall: 'italic',
        linkDestination: 'italic',
        heading: 'italic'
    }
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
        docTagValue: '#abadb3',
        functionDeclaration: '#56a8f5',
        functionCall: '#bcbec4',
        builtin: '#bcbec4',
        type: '#bcbec4',
        variable: '#bcbec4',
        parameter: '#bcbec4',
        localVariable: '#a9b7c6',
        phpVariable: '#9876aa',
        phpConstant: '#9876aa',
        typeParameter: '#598581',
        property: '#c77dbb',
        staticProperty: '#c77dbb',
        call: '#57aaf7',
        staticCall: '#57aaf7',
        methodCall: '#56a8f5',
        operator: '#bcbec4',
        punctuation: '#bcbec4',
        decorator: '#b3ae60',
        tag: '#d5b778',
        tagPunctuation: '#d5b778',
        customTag: '#2fbaa3',
        attribute: '#bababa',
        entity: '#56a8f5',
        color: '#56a8f5',
        anchor: '#e8bf6a',
        label: '#bcbec4',
        regex: '#42c3d4',
        heading: '#c77dbb',
        link: '#56a8f5',
        linkDestination: '#57aaf7',
        inlineCode: '#bcbec4',
        inserted: '#6aab73',
        deleted: '#fa6675',
        changed: '#56a8f5',
        diffHeader: '#cf8e6d'
    },
    fontStyles: {
        constant: 'italic',
        docComment: 'italic',
        builtin: 'italic',
        label: 'bold',
        phpConstant: 'italic',
        staticProperty: 'italic',
        staticCall: 'italic',
        linkDestination: 'italic',
        heading: 'italic'
    }
};

export const CODE_PALETTES: Readonly<Record<CodeThemeMode, CodePalette>> = { light: LIGHT, dark: DARK };

/* Root scopes of the grammars of TypeScript and JavaScript; a rule for one language leads with its root, which also wins over a rule without a parent. */
const SCRIPT_ROOTS = ['source.ts', 'source.tsx', 'source.js', 'source.jsx'];

function inScripts(...selectors: readonly string[]): string[] {
    return SCRIPT_ROOTS.flatMap((root) => selectors.map((selector) => `${root} ${selector}`));
}

/*
 * Which scopes each role covers, for the grammars of TypeScript, JavaScript, Python, Rust, Go, PHP,
 * Swift, JSON, YAML, Markdown, CSS, SCSS, HTML, Vue, shell and diff. The order carries no weight: a
 * TextMate theme lets the longest matching scope win, and a selector with a parent beats the same
 * scope without one. The narrower entries lean on that, such as a property name in JSON leaving the
 * types it is filed under, or a PHP variable leaving the plain ones. Where the platform colors a
 * language apart from the rest, the rule leads with the root scope of that grammar.
 */
const SCOPES: Readonly<Record<CodeRole, readonly string[]>> = {
    foreground: ['string.unquoted.plain.out.yaml', 'string.unquoted.plain.in.yaml', 'source.yaml constant.numeric', 'source.yaml constant.language'],
    comment: ['comment', 'punctuation.definition.comment', 'string.comment'],
    docComment: [
        'comment.block.documentation',
        'comment.line.documentation',
        'comment.line.triple-slash.documentation',
        // `/**` and `*/` are punctuation inside the doc comment, and the bare `punctuation.definition.comment` above would make them gray.
        'comment.block.documentation punctuation.definition.comment',
        'source.yaml comment',
        'source.yaml punctuation.definition.comment'
    ],
    docTag: [
        'comment.block.documentation storage.type',
        'comment.block.documentation punctuation.definition.block.tag',
        'comment.block.documentation punctuation.definition.bracket',
        'comment.block.documentation punctuation.definition.inline.tag',
        'storage.type.class.jsdoc',
        'keyword.other.phpdoc'
    ],
    docTagValue: [
        'comment.block.documentation entity.name.type',
        'comment.block.documentation variable',
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
        'beginning.punctuation.definition.list.markdown',
        'punctuation.definition.heading',
        'punctuation.definition.raw',
        'punctuation.definition.bold',
        'punctuation.definition.italic',
        'punctuation.definition.link.title',
        'punctuation.definition.quote',
        'punctuation.definition.markdown',
        'meta.separator.markdown',
        'keyword.other.type.php',
        'source.php constant.language',
        'source.php support.function.construct',
        'source.json constant.language',
        'source.yaml entity.name.tag',
        'source.css punctuation.definition.keyword',
        ...inScripts('constant.language', 'support.type.primitive', 'support.type.builtin')
    ],
    operator: ['keyword.operator', 'storage.type.function.arrow', ...inScripts('constant.language.import-export-all')],
    punctuation: ['punctuation', 'meta.brace', 'meta.delimiter'],
    string: ['string', 'punctuation.definition.string', 'markup.quote', 'keyword.other.unit', 'source.css support.constant'],
    escape: ['constant.character.escape', 'constant.character.format.placeholder', 'constant.other.placeholder'],
    number: ['constant.numeric'],
    constant: [
        'constant.language',
        'constant.character',
        'constant.other',
        'support.constant',
        'variable.other.constant',
        'variable.other.enummember',
        'entity.name.constant',
        'constant.other.option',
        'fenced_code.block.language'
    ],
    phpConstant: ['source.php constant.other', 'source.php constant.enum', 'source.php support.constant'],
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
    call: [
        'entity.name.function.call',
        'source.php meta.function-call entity.name.function',
        'source.php meta.function-call support.function',
        'source.php meta.method-call entity.name.function',
        ...inScripts('meta.function-call entity.name.function', 'meta.function-call variable.function', 'support.function')
    ],
    staticCall: ['entity.name.function.static', 'source.php meta.method-call.static entity.name.function'],
    methodCall: ['entity.name.function.method'],
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
        'support.other.namespace.php',
        'comment.block.documentation keyword.other.type.php'
    ],
    typeParameter: ['entity.name.type.parameter'],
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
        'string.unquoted.shell',
        ...inScripts('variable.other.readwrite.alias')
    ],
    localVariable: inScripts('variable.other.readwrite', 'meta.definition.variable variable.other.constant'),
    phpVariable: [
        'source.php variable.other',
        'source.php variable.other punctuation.definition.variable',
        'source.php variable.language.this',
        'source.php variable.language.this punctuation.definition.variable'
    ],
    parameter: ['variable.parameter'],
    property: [
        'variable.other.property',
        'variable.other.object.property',
        'support.variable.property',
        'meta.object-literal.key',
        'meta.attribute.python',
        'support.type.property-name',
        'punctuation.support.type.property-name',
        'variable.other.member',
        'entity.name.variable.field'
    ],
    staticProperty: ['variable.other.property.static', 'source.php variable.other.class', 'source.php variable.other.class punctuation.definition.variable'],
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
    tag: [
        'entity.name.tag',
        'meta.tag.sgml',
        'source.css entity.other.attribute-name',
        'source.css punctuation.definition.entity',
        'source.css support.function'
    ],
    tagPunctuation: ['punctuation.definition.tag'],
    customTag: ['meta.tag.custom entity.name.tag'],
    attribute: ['entity.other.attribute-name', 'source.css support.type.property-name', 'variable.css'],
    entity: ['constant.character.entity', 'punctuation.definition.entity.html'],
    color: ['source.css constant.other.color', 'source.css punctuation.definition.constant'],
    anchor: ['entity.name.type.anchor.yaml', 'punctuation.definition.anchor.yaml', 'punctuation.definition.alias.yaml', 'variable.other.alias.yaml'],
    label: ['entity.name.label', 'punctuation.definition.label', 'keyword.operator.heredoc'],
    heading: ['markup.heading', 'entity.name.section'],
    link: ['markup.link', 'constant.other.reference.link', 'string.other.link'],
    linkDestination: ['markup.underline.link'],
    inlineCode: ['markup.inline.raw', 'markup.raw.block'],
    inserted: ['markup.inserted', 'punctuation.definition.inserted'],
    deleted: ['markup.deleted', 'punctuation.definition.deleted'],
    changed: ['markup.changed', 'punctuation.definition.changed'],
    diffHeader: ['meta.diff.header', 'meta.diff.range', 'meta.diff.index', 'punctuation.definition.from-file', 'punctuation.definition.to-file']
};

type Rule = NonNullable<ThemeRegistration['tokenColors']>[number];

function tokenColors(palette: CodePalette): Rule[] {
    return [
        ...Object.entries(SCOPES).map(([role, scope]) => {
            const fontStyle = palette.fontStyles[role as CodeRole];
            return { scope: [...scope], settings: { foreground: palette.colors[role as CodeRole], ...(fontStyle === undefined ? {} : { fontStyle }) } };
        }),
        // Emphasis keeps the color of the text it is in.
        { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
        { scope: ['markup.italic'], settings: { fontStyle: 'italic' } }
    ];
}

function themeOf(type: CodeThemeMode, palette: CodePalette): CodeTheme {
    return {
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
    };
}

/* Ruimte's own code themes, light first. Shiki takes them as they are, so they go wherever a bundled theme id does once resolved. */
export const CODE_THEMES: readonly CodeTheme[] = [themeOf('light', LIGHT), themeOf('dark', DARK)];

function ownCodeTheme(id: string): CodeTheme | null {
    return CODE_THEMES.find((theme) => theme.name === id) ?? null;
}

/* What to hand Shiki for a theme id: our theme itself, or the id of a bundled one for Shiki to load. */
export function shikiThemeOf(id: string): string | ThemeRegistration {
    return ownCodeTheme(id) ?? id;
}
