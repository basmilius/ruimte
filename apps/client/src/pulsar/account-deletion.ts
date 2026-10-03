import i18next from 'i18next';
import { hasLocalMachine } from '@/state/local-machine';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { serverInfoOf } from '@/state/server';
import { deletePulsarAccount, usePulsarAccount } from './account';
import { confirmAccount } from './confirmation';
import { leaveAccount } from './machines';

/* What happened to the machine this app runs on: off the deleted account, never on it, or still on it. */
export type LocalLeave = 'left' | 'not-on-it' | 'failed';

/*
 * The machine keeps the account it signed for until a person on it leaves, so a deleted account would
 * otherwise refuse the next sign-in here. Only a machine on that very account leaves: one on another
 * account is someone else's business.
 */
export const leaveThisComputer = async (accountId: string): Promise<LocalLeave> => {
    if (!hasLocalMachine() || serverInfoOf(LOCAL_ENDPOINT_ID).accountId !== accountId) {
        return 'not-on-it';
    }
    try {
        await leaveAccount(LOCAL_ENDPOINT_ID, LOCAL_ENDPOINT_ID);
        return 'left';
    } catch {
        return 'failed';
    }
};

const CONFIRMATIONS: Record<LocalLeave, string> = {
    left: 'machines:account.confirmation.deletedAndLeft',
    'not-on-it': 'machines:account.confirmation.deleted',
    failed: 'machines:account.confirmation.deletedLeaveFailed'
};

/* Deletes the account, signs this app out and takes this computer's machine off it, then says how that went. */
export const deleteAccountHere = async (confirmation: string, leave: (accountId: string) => Promise<LocalLeave> = leaveThisComputer): Promise<void> => {
    const accountId = usePulsarAccount.getState().account?.id ?? null;
    await deletePulsarAccount(confirmation);
    const outcome = accountId === null ? 'not-on-it' : await leave(accountId);
    confirmAccount(i18next.t(CONFIRMATIONS[outcome]));
};
