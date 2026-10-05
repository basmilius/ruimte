const compiled = new Map<string, RegExp | null>();

function escapeRegex(char: string): string {
    return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileGlob(pattern: string): RegExp | null {
    let expression = '';
    let depth = 0;
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        if (char === '*') {
            if (pattern[i + 1] === '*') {
                i++;
                if (pattern[i + 1] === '/') {
                    expression += '(?:.*/)?';
                    i++;
                } else {
                    expression += '.*';
                }
            } else {
                expression += '[^/]*';
            }
        } else if (char === '?') {
            expression += '[^/]';
        } else if (char === '[') {
            const close = pattern.indexOf(']', i + 2);
            if (close === -1) {
                expression += '\\[';
            } else {
                const body = pattern.slice(i + 1, close);
                expression += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`;
                i = close;
            }
        } else if (char === '{') {
            depth++;
            expression += '(?:';
        } else if (char === '}' && depth > 0) {
            depth--;
            expression += ')';
        } else if (char === ',' && depth > 0) {
            expression += '|';
        } else {
            expression += escapeRegex(char);
        }
    }
    try {
        return new RegExp(`^${expression}$`);
    } catch {
        return null;
    }
}

/* The glob of the protocol: `*`, `**`, `?`, `[a-z]`, `[!a-z]` and `{a,b}`. */
export function globMatch(path: string, pattern: string): boolean {
    if (!compiled.has(pattern)) {
        compiled.set(pattern, compileGlob(pattern));
    }
    return compiled.get(pattern)?.test(path) ?? false;
}
