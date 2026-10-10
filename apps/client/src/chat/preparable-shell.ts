import { shellCommandLine, ShellLanguageSchema, type ShellLanguage } from '@ruimte/contracts';
import type { ShellCodeBlockContext } from '@adecore/agents-react/host';

/* The shell a finished code block runs in, or null when it is not one command line the terminal can take. */
export function preparableShell(context: ShellCodeBlockContext): ShellLanguage | null {
    const language = ShellLanguageSchema.safeParse(context.language);
    return context.complete && language.success && shellCommandLine(context.code) !== null ? language.data : null;
}
