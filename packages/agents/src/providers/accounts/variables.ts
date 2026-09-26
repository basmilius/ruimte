import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { ProviderAccountVariable } from '@ruimte/agent-contracts';
import { CodedError } from '../../coded-error.ts';
import { runProcess } from '../../run-process.ts';

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

/* The names that decide which folder and which executable a CLI talks to. */
const RESERVED = new Set(['HOME', 'PATH']);

/* The app that runs the CLIs, as far as their accounts go: what a person calls it and which variables it sets itself. */
export interface AccountsHost {
    name: string;
    // No account may set a variable with one of these prefixes, since the app sets them for every CLI.
    variablePrefixes: readonly string[];
    // Keeps the app's keychain values apart from any other app's.
    keychainPrefix: string;
}

export const DEFAULT_ACCOUNTS_HOST: AccountsHost = { name: 'the app', variablePrefixes: [], keychainPrefix: 'agents' };

/* The variables no account may set: the host's own and the ones that point a CLI at its folder. */
export interface ReservedVariables {
    host: AccountsHost;
    folderVariables: readonly string[];
}

export const isReservedName = (name: string, reserved: ReservedVariables): boolean =>
    RESERVED.has(name) || reserved.host.variablePrefixes.some((prefix) => name.startsWith(prefix)) || reserved.folderVariables.includes(name);

/* `security` prints anything else as hex, so a read could not tell such a value from its own encoding. */
const isPrintableAscii = (value: string): boolean => /^[\x20-\x7e]*$/.test(value);

/* What is wrong with the variables of an account, or null when nothing is. A secret that is only redacted is judged by the service. */
export const variablesProblem = (variables: readonly ProviderAccountVariable[], reserved: ReservedVariables): string | null => {
    const seen = new Set<string>();
    for (const variable of variables) {
        if (seen.has(variable.name)) {
            return `${variable.name} is set twice`;
        }
        seen.add(variable.name);
        if (isReservedName(variable.name, reserved)) {
            return `${variable.name} is set by ${reserved.host.name} itself`;
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

/* A data folder of its own (a development one beside an installed one) keeps its values apart from the other's. */
export const keychainService = (host: AccountsHost, home: string): string =>
    `${host.keychainPrefix}-provider-env-${createHash('sha256').update(resolve(home)).digest('hex').slice(0, 12)}`;
// `security` exits with this when no item matches.
const NOT_FOUND = 44;

const run = async (args: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }> => {
    const { exitCode, stdout, stderr } = await runProcess(['security', ...args], { ...(stdin === undefined ? {} : { stdin }) });
    return { code: exitCode ?? 1, stdout, stderr };
};

/*
 * Generic passwords in the login keychain, through the `security` CLI. A value goes in over stdin as
 * hex in its interactive mode: on the command line any process could read it, and the password
 * prompt cuts it at 128 characters.
 */
export const keychainSecrets = (service: string): SecretStore => ({
    read: async (key) => {
        const { code, stdout, stderr } = await run(['find-generic-password', '-s', service, '-a', key, '-w']);
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
        const { code, stderr } = await run(['-i'], `add-generic-password -U -s ${service} -a ${quoted} -X ${hex}\n`);
        if (code !== 0) {
            throw new Error(`The keychain did not take ${key}: ${stderr.trim()}`);
        }
    },
    remove: async (key) => {
        const { code, stderr } = await run(['delete-generic-password', '-s', service, '-a', key]);
        if (code !== 0 && code !== NOT_FOUND) {
            throw new Error(`The keychain did not remove ${key}: ${stderr.trim()}`);
        }
    }
});

/* The keychain on macOS; elsewhere none, so a sensitive variable is refused. */
export const platformSecrets = (host: AccountsHost, home: string): SecretStore | null =>
    process.platform === 'darwin' ? keychainSecrets(keychainService(host, home)) : null;
