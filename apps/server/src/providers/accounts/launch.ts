import type { AgentKind } from '@ruimte/contracts';
import { CodedError } from '../../coded-error.ts';
import type { Env } from './accounts.ts';

export class AccountError extends CodedError<'account-unavailable' | 'account-incompatible'> {}

/*
 * The accounts as a terminal or a chat starts a CLI under one. Absent, or the CLI's own kind, is the
 * default account, which leaves everything exactly as it is without accounts.
 */
export interface AccountLaunches {
    /* The environment of a CLI of this kind under this account. Throws an `AccountError` for one this machine cannot start. */
    envFor(kind: AgentKind, account: string | undefined, baseEnv: Env): Env;
    /* The config folder the CLI writes this account's conversations in; null for an account this machine does not have. */
    transcriptFolder(kind: AgentKind, account: string | undefined): string | null;
    /* Whether a conversation of one account can go on under the other: the same CLI, reading the same transcripts. */
    canContinue(kind: AgentKind, from: string | undefined, to: string | undefined): boolean;
    /* What a person calls the account. */
    labelOf(account: string): string;
}

export const isDefaultAccountOf = (kind: AgentKind, account: string | undefined): boolean => account === undefined || account === kind;

/* The id a record or a node keeps: none for the default account, so nothing without accounts changes on disk. */
export const storedAccount = (kind: AgentKind, account: string | undefined): string | undefined => (isDefaultAccountOf(kind, account) ? undefined : account);

/* The environment of a launch; without accounts wired only the default account can start. */
export const launchEnv = (accounts: AccountLaunches | null, kind: AgentKind, account: string | undefined, baseEnv: Env): Env => {
    if (isDefaultAccountOf(kind, account)) {
        return baseEnv;
    }
    if (accounts === null) {
        throw new AccountError('account-unavailable', `The account '${account}' is not available on this machine: it keeps no accounts.`);
    }
    return accounts.envFor(kind, account, baseEnv);
};

/* An environment without its unset variables, which is what a spawned process is given. */
export const definedEnv = (env: Env): Record<string, string> => {
    const defined: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) {
            defined[key] = value;
        }
    }
    return defined;
};
