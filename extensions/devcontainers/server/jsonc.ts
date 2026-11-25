/*
 * JSON as a devcontainer.json is written: with `//` and block comments, and a comma after the last entry of an object
 * or a list. What is inside a string stays as it is.
 */
export function parseJsonc(text: string): unknown {
    let plain = '';
    let i = 0;

    while (i < text.length) {
        const char = text[i] as string;
        const next = text[i + 1];

        if (char === '"') {
            const end = stringEnd(text, i);

            plain += text.slice(i, end);
            i = end;
        } else if (char === '/' && next === '/') {
            const end = text.indexOf('\n', i);

            i = end === -1 ? text.length : end;
        } else if (char === '/' && next === '*') {
            const end = text.indexOf('*/', i + 2);

            // A space, so two words a comment stood between stay two.
            plain += ' ';
            i = end === -1 ? text.length : end + 2;
        } else if (char === ',' && closesAfter(text, i + 1)) {
            i += 1;
        } else {
            plain += char;
            i += 1;
        }
    }

    return JSON.parse(plain);
}

/* The index after the string that opens at `start`. */
function stringEnd(text: string, start: number): number {
    let i = start + 1;

    while (i < text.length && text[i] !== '"') {
        i += text[i] === '\\' ? 2 : 1;
    }

    return Math.min(i + 1, text.length);
}

/* Whether only space and comments stand between `from` and the `}` or `]` that closes. */
function closesAfter(text: string, from: number): boolean {
    let i = from;

    while (i < text.length) {
        const char = text[i] as string;

        if (char === '/' && text[i + 1] === '/') {
            const end = text.indexOf('\n', i);

            i = end === -1 ? text.length : end;
        } else if (char === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);

            i = end === -1 ? text.length : end + 2;
        } else if (/\s/.test(char)) {
            i += 1;
        } else {
            return char === '}' || char === ']';
        }
    }

    return false;
}
