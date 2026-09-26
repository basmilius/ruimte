import { useMemo } from 'react';
import { useUsage } from '../state/usage';
import { moneyFormat } from './format';

/*
 * The formatter every amount on the page goes through: the currency that was chosen, at the rate
 * the summary on screen carries. It is a hook rather than a prop because every row wants it and
 * none of them wants to know where the rate came from.
 */
export const useMoney = (): ((usd: number) => string) => {
    const currency = useUsage((s) => s.currency);
    const rate = useUsage((s) => s.summary?.rate ?? null);
    return useMemo(() => moneyFormat(currency, rate), [currency, rate]);
};
