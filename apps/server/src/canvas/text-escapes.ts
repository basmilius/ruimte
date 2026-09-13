/*
 * A shell hands `--text "a\nb"` to the daemon with the backslash still in it, so the daemon is what
 * reads the escapes a person types by hand. Only these three: a `\d` in a note stays a `\d`.
 */
export const unescapeText = (value: string): string =>
    value.replace(/\\([\\nt])/g, (_match, char: string) => {
        if (char === 'n') {
            return '\n';
        }
        return char === 't' ? '\t' : '\\';
    });

/* The other way, for bytes that must arrive untouched: the CLI escapes what `unescapeText` would read. */
export const escapeText = (value: string): string => value.replaceAll('\\', '\\\\');
