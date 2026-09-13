export type ParsedArgv =
    | { ok: true; positionals: string[]; flags: Record<string, string> }
    | { ok: false; code: 'unknown-flag' | 'missing-value' | 'duplicate-flag'; message: string };

/*
 * Splits the words after a verb into positionals and `--flag value` pairs (`--flag=value` too, for a
 * value that itself starts with `--`). Every flag takes a value, so a bare switch cannot mean
 * something here, and a flag given twice is refused rather than one of the two silently winning.
 */
export const parseArgv = (argv: readonly string[], known: readonly string[]): ParsedArgv => {
    const positionals: string[] = [];
    const flags: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const word = argv[i]!;
        if (!word.startsWith('--')) {
            positionals.push(word);
            continue;
        }
        const equals = word.indexOf('=');
        const name = word.slice(2, equals === -1 ? undefined : equals);
        if (!known.includes(name)) {
            return {
                ok: false,
                code: 'unknown-flag',
                message: known.length === 0 ? `--${name} is not a flag here; this verb takes none` : `--${name} is not one of --${known.join(', --')}`
            };
        }
        if (Object.hasOwn(flags, name)) {
            return { ok: false, code: 'duplicate-flag', message: `--${name} is given twice` };
        }
        let value: string;
        if (equals !== -1) {
            value = word.slice(equals + 1);
        } else {
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) {
                return { ok: false, code: 'missing-value', message: `--${name} needs a value (write --${name}=<value> for one that starts with --)` };
            }
            value = next;
            i++;
        }
        flags[name] = value;
    }
    return { ok: true, positionals, flags };
};
