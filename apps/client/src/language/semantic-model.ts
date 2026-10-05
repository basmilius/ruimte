import type { EditorSemanticToken } from '@ruimte/smart-editor';
import type { SemanticTokens, SemanticTokensLegend } from '@ruimte/smart-editor-lsp';

/*
 * The TextMate scopes a classification stands for, so the editor's theme colors it the way its own
 * grammar colors the same thing. Null where the grammar already did better: a keyword, a string, a
 * local variable. A function being called, a method, a static member and a declaration are scopes of
 * their own, as the platform's color scheme tells them apart. `scoped` says the server marks what is
 * local to a function, so a variable it leaves unmarked lives at the top of a file or comes from a
 * library, which the scheme draws as a global.
 */
export function scopesOf(type: string, modifiers: ReadonlySet<string>, scoped = false): string[] | null {
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
            return ['entity.name.type'];
        case 'typeParameter':
            return ['entity.name.type.parameter'];
        case 'parameter':
            return ['variable.parameter'];
        case 'property':
            return [modifiers.has('static') ? 'variable.other.property.static' : 'variable.other.property'];
        case 'enumMember':
            return ['variable.other.enummember'];
        case 'function':
        case 'method':
            if (modifiers.has('static')) {
                return ['entity.name.function.static'];
            }
            if (modifiers.has('declaration')) {
                return ['entity.name.function'];
            }
            return [type === 'method' ? 'entity.name.function.method' : 'entity.name.function.call'];
        case 'decorator':
            return ['meta.decorator'];
        case 'macro':
            return ['entity.name.function.macro'];
        case 'variable':
            if (scoped) {
                return modifiers.has('local') ? null : ['variable.other.constant'];
            }
            return modifiers.has('readonly') ? ['variable.other.constant'] : null;
        default:
            return null;
    }
}

/* The encoded data of `textDocument/semanticTokens` as one token per classified range, the ones the theme has nothing to say about left out. */
export function decodeSemanticTokens(tokens: SemanticTokens, legend: SemanticTokensLegend): EditorSemanticToken[] {
    const result: EditorSemanticToken[] = [];
    const { data } = tokens;
    const scoped = legend.tokenModifiers.includes('local');
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
        const scopes = scopesOf(type, modifiers, scoped);
        if (scopes !== null) {
            result.push({ line, character, length: data[at + 2]!, scopes });
        }
    }
    return result;
}
