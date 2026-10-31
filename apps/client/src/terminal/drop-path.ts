// Line breaks and escapes in a name are input to the program: xterm's paste keeps ESC, so `ESC[201~` would end a bracketed paste and run what follows.
const CONTROL = /\p{Cc}/u;
const POSIX_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

function posixQuoted(path: string): string {
    return POSIX_SAFE.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`;
}

// PowerShell also ends a single-quoted string on a typographic quote, and doubling is its one escape for all of them.
function powerShellQuoted(path: string): string {
    return `'${path.replace(/['‘’‚‛]/g, '$&$&')}'`;
}

// Inside double quotes cmd still expands `%`, and `!` under delayed expansion, with no escape for either. A program reads `\"` as a quote, so a closing backslash is doubled.
function cmdQuoted(path: string): string | null {
    return /[%!]/.test(path) ? null : `"${path.replace(/\\+$/, '$&$&')}"`;
}

/*
 * A session from a machine that does not name its shell. PowerShell's form never runs anything in Git Bash either,
 * where a doubled apostrophe only joins two literal strings. In cmd it is no quoting at all, so what cmd acts on stays out.
 */
function unknownShellQuoted(path: string): string | null {
    return /[&|<>^%!]/.test(path) ? null : powerShellQuoted(path);
}

function windowsQuote(shell: string | undefined): (path: string) => string | null {
    switch (shell?.toLowerCase()) {
        case 'powershell':
        case 'pwsh':
            return powerShellQuoted;
        case 'cmd':
            return cmdQuoted;
        case 'bash':
        case 'sh':
        case 'wsl':
            return (path) => `'${path.replaceAll("'", `'\\''`)}'`;
        default:
            return unknownShellQuoted;
    }
}

/*
 * The paths of a drop as typed after a prompt: each quoted for the session's shell, one space between them and one
 * after the last. Null when that shell cannot read one of them literally, so nothing may be typed.
 */
export function shellQuotedPaths(paths: readonly string[], platform: string | null, shell?: string): string | null {
    const quote = platform === 'win32' ? windowsQuote(shell) : posixQuoted;
    const quoted = paths.map(quote);
    return quoted.includes(null) ? null : `${quoted.join(' ')} `;
}

/* Whether a path holds a control character (C0, DEL or C1), which no quoting makes safe to type. */
export function hasControlCharacter(path: string): boolean {
    return CONTROL.test(path);
}
