/*
 * The file patterns of a language server of a person's own, such as `*.zig` or `templates/**`. A pattern
 * without a slash is matched against the file name at any depth, one with a slash against the stored
 * path (`stored-path.ts`). `*` stops at a slash, `**` does not, `?` is one character and `{a,b}` is a choice.
 */

function escapeLiteral(character: string): string {
    return /[\\^$.*+?()[\]{}|/]/.test(character) ? `\\${character}` : character;
}

/* The expression of a pattern, or null for one that does not close its braces. */
function compile(pattern: string): RegExp | null {
    const text = pattern.replace(/^\.?\//, '');
    let source = '';
    let braces = 0;
    for (let index = 0; index < text.length; index++) {
        const character = text[index]!;
        if (character === '*' && text[index + 1] === '*') {
            index++;
            if (text[index + 1] === '/') {
                index++;
                source += '(?:.*/)?';
            } else {
                source += '.*';
            }
        } else if (character === '*') {
            source += '[^/]*';
        } else if (character === '?') {
            source += '[^/]';
        } else if (character === '{') {
            braces++;
            source += '(?:';
        } else if (character === '}' && braces > 0) {
            braces--;
            source += ')';
        } else if (character === ',' && braces > 0) {
            source += '|';
        } else {
            source += escapeLiteral(character);
        }
    }
    return braces === 0 ? new RegExp(`^${source}$`) : null;
}

export function isValidFilePattern(pattern: string): boolean {
    return pattern.trim() !== '' && compile(pattern.trim()) !== null;
}

export function matchesFilePattern(pattern: string, storedPath: string): boolean {
    const trimmed = pattern.trim();
    const target = trimmed.includes('/') ? storedPath : storedPath.slice(storedPath.lastIndexOf('/') + 1);
    return compile(trimmed)?.test(target) ?? false;
}
