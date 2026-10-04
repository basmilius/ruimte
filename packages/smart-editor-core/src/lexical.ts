export const openers: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };

/* Words after which a `/` starts a regex and a `{` an object or a block, not a division or a statement end. */
const expressionWords = /^(return|throw|case|yield|await|new|delete|typeof|void|in|of|instanceof)$/;

export function isScript(language: string): boolean {
    return /^(typescript|javascript|typescriptreact|javascriptreact|tsx|jsx|ts|js|vue)$/i.test(language);
}

export function isPhp(language: string): boolean {
    return /^php$/i.test(language);
}

export function hasHashComments(language: string): boolean {
    return /^(php|python|py|sh|bash)$/i.test(language);
}

export function hasBlockComments(language: string): boolean {
    return !/^(plaintext|text|markdown|md|json|html|xml|python|py|sh|bash)$/i.test(language);
}

/* CSS has block comments only, and in Python `//` is a division. */
export function hasSlashComments(language: string): boolean {
    return hasBlockComments(language) && !/^css$/i.test(language);
}

export function hasMarkupComments(language: string): boolean {
    return /^(html|xml|vue)$/i.test(language);
}

export function hasSmartSemicolon(language: string): boolean {
    return /^(typescript|javascript|typescriptreact|javascriptreact|tsx|jsx|ts|js|php)$/i.test(language);
}

export function isWordCharacter(character: string): boolean {
    return /[\p{L}\p{N}_$]/u.test(character);
}

export function startsExpression(word: string): boolean {
    return expressionWords.test(word);
}

/* Whether what follows a punctuation character is an expression, so a `/` there is a regex. */
export function startsExpressionAfter(character: string): boolean {
    return /[=,:;!?+\-*%&|^~<>]/.test(character);
}
