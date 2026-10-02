import i18next from 'i18next';

/*
 * What a person reads when a machine or the address book will not put a machine on an account, in
 * place of the English sentence the refusal carries; null for any other failure. A machine is on one
 * account at a time, and only the app on it, or `ruimte login` there, puts it on one.
 */
export const accountRefusalText = (error: unknown): string | null => {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null;
    switch (code) {
        case 'forbidden':
            return i18next.t('machines:account.refusal.onlyOnMachine');
        case 'machine-has-account':
            return i18next.t('machines:account.refusal.machineHasAccount');
        case 'machine-on-other-account':
            return i18next.t('machines:account.refusal.listedElsewhere');
        default:
            return null;
    }
};
