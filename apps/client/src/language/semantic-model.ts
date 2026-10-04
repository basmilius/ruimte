import type { EditorSemanticToken } from '@ruimte/smart-editor';
import type { SemanticTokens, SemanticTokensLegend } from '@ruimte/smart-editor-lsp';

/*
 * The TextMate scopes a classification stands for, so the editor's theme colors it the way its own
 * grammar colors the same thing. Null where the grammar already did better: a keyword, a string, a
 * plain variable. A function being called is a different scope from one being declared, as the
 * theme's own palette tells them apart.
 */
export function scopesOf(type: string, modifiers: ReadonlySet<string>): string[] | null {
    switch (type) {
        case 'namespace':
            return ['entity.name.namespace'];
        case 'class':
            return ['entity.name.type.class'];
        case 'enum':
            return ['entity.name.type.enum'];
        case 'interface':
            return ['entity.name.type.interface'];
        case 'struct':
            return ['entity.name.type.struct'];
        case 'type':
        case 'typeParameter':
            return ['entity.name.type'];
        case 'parameter':
            return ['variable.parameter'];
        case 'property':
            return ['variable.other.property'];
        case 'enumMember':
            return ['variable.other.enummember'];
        case 'function':
        case 'method':
            if (modifiers.has('defaultLibrary')) {
                return ['support.function'];
            }
            return modifiers.has('declaration') ? ['entity.name.function'] : ['meta.function-call', 'entity.name.function'];
        case 'macro':
            return ['entity.name.function.macro'];
        case 'variable':
            return modifiers.has('readonly') ? ['variable.other.constant'] : null;
        default:
            return null;
    }
}

/* The encoded data of `textDocument/semanticTokens` as one token per classified range, the ones the theme has nothing to say about left out. */
export function decodeSemanticTokens(tokens: SemanticTokens, legend: SemanticTokensLegend): EditorSemanticToken[] {
    const result: EditorSemanticToken[] = [];
    const { data } = tokens;
    let line = 0;
    let character = 0;
    for (let at = 0; at + 4 < data.length; at += 5) {
        const deltaLine = data[at]!;
        line += deltaLine;
        character = deltaLine === 0 ? character + data[at + 1]! : data[at + 1]!;
        const type = legend.tokenTypes[data[at + 3]!];
        if (type === undefined) {
            continue;
        }
        const bits = data[at + 4]!;
        const modifiers = new Set(legend.tokenModifiers.filter((_, index) => (bits & (1 << index)) !== 0));
        const scopes = scopesOf(type, modifiers);
        if (scopes !== null) {
            result.push({ line, character, length: data[at + 2]!, scopes });
        }
    }
    return result;
}
