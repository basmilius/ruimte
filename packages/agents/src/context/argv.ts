export type ParsedArgv =
    | { ok: true; positionals: string[]; flags: Record<string, string>; switches: Set<string> }
    | { ok: false; code: 'unknown-flag' | 'missing-value' | 'duplicate-flag' | 'unexpected-value'; message: string };

/*
 * Splits the words after a verb into positionals, `--flag value` pairs (`--flag=value` too, for a
 * value that itself starts with `--`) and the switches the verb declared. Anything not declared a
 * switch takes a value, so a flag that lost its argument is refused instead of swallowing the next
 * word, and a flag given twice is refused rather than one of the two silently winning. A name that is
 * both a switch and a flag is on when written bare and takes a value only after `=` (`--state=full`).
 */
export const parseArgv = (argv: readonly string[], known: readonly string[], switches: readonly string[] = []): ParsedArgv => {
    const positionals: string[] = [];
    const flags: Record<string, string> = {};
    const given = new Set<string>();
    const all = [...new Set([...known, ...switches])];
    for (let i = 0; i < argv.length; i++) {
        const word = argv[i]!;
        if (!word.startsWith('--')) {
            positionals.push(word);
            continue;
        }
        const equals = word.indexOf('=');
        const name = word.slice(2, equals === -1 ? undefined : equals);
        if (!all.includes(name)) {
            return {
                ok: false,
                code: 'unknown-flag',
                message: all.length === 0 ? `--${name} is not a flag here; this verb takes none` : `--${name} is not one of --${all.join(', --')}`
            };
        }
        if (Object.hasOwn(flags, name) || given.has(name)) {
            return { ok: false, code: 'duplicate-flag', message: `--${name} is given twice` };
        }
        if (switches.includes(name)) {
            if (equals !== -1 && known.includes(name)) {
                flags[name] = word.slice(equals + 1);
                given.add(name);
                continue;
            }
            if (equals !== -1) {
                return { ok: false, code: 'unexpected-value', message: `--${name} takes no value; it is on when you write it and off when you do not` };
            }
            given.add(name);
            continue;
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
    return { ok: true, positionals, flags, switches: given };
};
