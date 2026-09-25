import type { ProviderAccountVariable } from '@ruimte/contracts';
import { CodedError } from '../../coded-error.ts';

/*
 * The variables of an account, and where a sensitive value is kept: the keychain of this machine,
 * never `providers.json` and never the wire.
 */

export class SecretsUnavailableError extends CodedError<'secrets-unavailable'> {
    constructor() {
        super('secrets-unavailable', 'This machine has no keychain to keep a sensitive value in.');
    }
}

/* What keeps the sensitive values; a test keeps them in memory. */
export interface SecretStore {
    /* Null for a key it has nothing under. */
    read(key: string): Promise<string | null>;
    write(key: string, value: string): Promise<void>;
    /* Removing a key it has nothing under is not an error. */
    remove(key: string): Promise<void>;
}

export const secretKey = (accountId: string, name: string): string => `${accountId}/${name}`;

/* The names that decide which folder, which executable and which daemon a CLI talks to. */
const RESERVED = new Set(['HOME', 'PATH']);

export const isReservedName = (name: string, folderVariables: readonly string[]): boolean =>
    RESERVED.has(name) || name.startsWith('RUIMTE_') || folderVariables.includes(name);

/* `security` prints anything else as hex, so a read could not tell such a value from its own encoding. */
const isPrintableAscii = (value: string): boolean => /^[\x20-\x7e]*$/.test(value);

/* What is wrong with the variables of an account, or null when nothing is. A secret that is only redacted is judged by the service. */
export const variablesProblem = (variables: readonly ProviderAccountVariable[], folderVariables: readonly string[]): string | null => {
    const seen = new Set<string>();
    for (const variable of variables) {
        if (seen.has(variable.name)) {
            return `${variable.name} is set twice`;
        }
        seen.add(variable.name);
        if (isReservedName(variable.name, folderVariables)) {
            return `${variable.name} is set by Ruimte itself`;
        }
        if (variable.sensitive && !isPrintableAscii(variable.value)) {
            return `The value of ${variable.name} can only hold printable ASCII characters`;
        }
    }
    return null;
};

/* The variables as a client may read them: a sensitive value never leaves the machine. */
export const redactVariables = (variables: readonly ProviderAccountVariable[]): ProviderAccountVariable[] =>
    variables.map((variable) => (variable.sensitive ? { name: variable.name, value: '', sensitive: true, valueRedacted: true } : variable));

const SERVICE = 'ruimte-provider-env';
// `security` exits with this when no item matches.
const NOT_FOUND = 44;

const run = async (args: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }> => {
    const child = Bun.spawn(['security', ...args], { stdin: stdin === undefined ? 'ignore' : 'pipe', stdout: 'pipe', stderr: 'pipe' });
    if (stdin !== undefined && child.stdin) {
        child.stdin.write(stdin);
        child.stdin.end();
    }
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, stdout, stderr };
};

/*
 * Generic passwords in the login keychain, through the `security` CLI. A value goes in over stdin as
 * hex in its interactive mode: on the command line any process could read it, and the password
 * prompt cuts it at 128 characters.
 */
export const keychainSecrets = (): SecretStore => ({
    read: async (key) => {
        const { code, stdout, stderr } = await run(['find-generic-password', '-s', SERVICE, '-a', key, '-w']);
        if (code === NOT_FOUND) {
            return null;
        }
        if (code !== 0) {
            throw new Error(`The keychain did not give ${key}: ${stderr.trim()}`);
        }
        return stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
    },
    write: async (key, value) => {
        const hex = Buffer.from(value, 'utf8').toString('hex');
        const quoted = `"${key.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
        const { code, stderr } = await run(['-i'], `add-generic-password -U -s ${SERVICE} -a ${quoted} -X ${hex}\n`);
        if (code !== 0) {
            throw new Error(`The keychain did not take ${key}: ${stderr.trim()}`);
        }
    },
    remove: async (key) => {
        const { code, stderr } = await run(['delete-generic-password', '-s', SERVICE, '-a', key]);
        if (code !== 0 && code !== NOT_FOUND) {
            throw new Error(`The keychain did not remove ${key}: ${stderr.trim()}`);
        }
    }
});

/* The keychain on macOS; elsewhere none, so a sensitive variable is refused. */
export const platformSecrets = (): SecretStore | null => (process.platform === 'darwin' ? keychainSecrets() : null);
