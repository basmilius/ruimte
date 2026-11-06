/*
 * Writes the closed vocabularies of `@ruimte/extension` that the host needs at runtime, from the `.d.ts` an author reads:
 * the error codes a call can answer and the places a slot can go. The `.d.ts` keeps the types and the prose, so it is the
 * source and the host's lists follow it. `--check` fails on a stale file, and when the two `.d.ts` files name other codes.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const CLIENT = join(ROOT, 'packages', 'extension', 'client.d.ts');
const SERVER = join(ROOT, 'packages', 'extension', 'server.d.ts');
const OUTPUT = join(ROOT, 'packages', 'contracts', 'src', 'extension-vocabularies.generated.ts');
const PRINT_WIDTH = 160;

export function errorCodesOf(declarations: string): string[] {
    const union = /export type ExtensionErrorCode =([^;]+);/.exec(declarations)?.[1];

    if (union === undefined) {
        throw new Error('No ExtensionErrorCode found');
    }

    return [...union.matchAll(/'([a-z-]+)'/g)].map((match) => match[1] as string);
}

export function slotNamesOf(declarations: string): string[] {
    const body = /export interface SlotContexts \{\n([\s\S]*?)\n\}/.exec(declarations)?.[1];

    if (body === undefined) {
        throw new Error('No SlotContexts found');
    }

    return [...body.matchAll(/^ {4}(\w+): /gm)].map((match) => match[1] as string);
}

/* The way the formatter prints a list of strings: on one line while it fits, one per line past that. */
function list(name: string, items: readonly string[]): string {
    const quoted = items.map((item) => `'${item}'`);
    const line = `export const ${name} = [${quoted.join(', ')}] as const;`;

    return line.length <= PRINT_WIDTH ? line : `export const ${name} = [\n${quoted.map((item) => `    ${item}`).join(',\n')}\n] as const;`;
}

export function render(errorCodes: readonly string[], slotNames: readonly string[]): string {
    return [
        '// Generated from packages/extension/client.d.ts by packages/contracts/scripts/generate-extension-vocabularies.ts. Do not edit.',
        '',
        '/* Why a call of an extension came back without its answer, the `ExtensionErrorCode` of `@ruimte/extension`. */',
        list('EXTENSION_ERROR_CODES', errorCodes),
        '',
        '/* Every place an extension may put an action, a menu or a widget: the `SlotName` of `@ruimte/extension/client`. */',
        list('EXTENSION_SLOT_NAMES', slotNames),
        ''
    ].join('\n');
}

if (import.meta.main) {
    const client = await readFile(CLIENT, 'utf8');
    const server = await readFile(SERVER, 'utf8');
    const errorCodes = errorCodesOf(client);

    if (errorCodesOf(server).join() !== errorCodes.join()) {
        throw new Error('ExtensionErrorCode differs between packages/extension/client.d.ts and server.d.ts. Make them the same.');
    }

    const contents = render(errorCodes, slotNamesOf(client));

    if (!process.argv.includes('--check')) {
        await writeFile(OUTPUT, contents);
    } else if ((await readFile(OUTPUT, 'utf8').catch(() => '')) !== contents) {
        throw new Error(`Stale generated file: ${relative(process.cwd(), OUTPUT)}. Run bun packages/contracts/scripts/generate-extension-vocabularies.ts`);
    }

    console.log(`${process.argv.includes('--check') ? 'Checked' : 'Generated'} the extension vocabularies.`);
}
