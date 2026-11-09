import i18next from 'i18next';

export function errorCodeOf(error: unknown): string | null {
    return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null;
}

/*
 * What a person reads when a machine or the address book will not put a machine on an account, in
 * place of the English sentence the refusal carries; null for any other failure.
 */
export function accountRefusalText(error: unknown): string | null {
    switch (errorCodeOf(error)) {
        case 'forbidden':
            return i18next.t('machines:account.refusal.onlyOnMachine');
        case 'machine-has-account':
            return i18next.t('machines:account.refusal.machineHasAccount');
        case 'machine-on-other-account':
            return i18next.t('machines:account.refusal.listedElsewhere');
        default:
            return null;
    }
}
