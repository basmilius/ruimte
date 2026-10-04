import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { errorText } from '../error-text.ts';
import { isNotFound, writeAtomic } from '../fs.ts';

/*
 * The commands a host lets Codex run outside its sandbox without asking: the seatbelt of
 * workspace-write blocks every socket, loopback included, and Codex 0.157 has no setting that opens
 * only the one a host's context CLI posts to. Opening the network for the whole sandbox would let
 * every command out; this lets out only the named ones, which the host enforces on its side.
 */
export interface CodexRules {
    /* Names the file and says who wrote it, so a person's `default.rules` is never touched. */
    app: string;
    commands: readonly string[];
}

export type CodexRulesResult = 'unchanged' | 'written';

export function codexRulesText(rules: CodexRules): string {
    return (
        [
            `# Written by ${rules.app}; it is rewritten when it changes.`,
            ...rules.commands.map((command) => `prefix_rule(pattern=[${JSON.stringify(command)}], decision="allow")`)
        ].join('\n') + '\n'
    );
}

// Codex loads every `*.rules` file in the `rules` folder of its home, and only from there, never from a flag.
export function codexRulesPathIn(folder: string, rules: CodexRules): string {
    return join(folder, 'rules', `${rules.app.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.rules`);
}

export function defaultCodexHome(env: Record<string, string | undefined> = process.env): string {
    return env.CODEX_HOME ?? join(env.HOME ?? homedir(), '.codex');
}

/* Idempotent: a file that already says the same is left alone. */
export async function installCodexRules(path: string, rules: CodexRules): Promise<CodexRulesResult> {
    const text = codexRulesText(rules);
    try {
        if ((await readFile(path, 'utf8')) === text) {
            return 'unchanged';
        }
    } catch (e) {
        if (!isNotFound(e)) {
            throw new Error(`Cannot read ${path}: ${errorText(e)}`);
        }
    }
    await mkdir(dirname(path), { recursive: true });
    await writeAtomic(path, text, 0o644);
    return 'written';
}
