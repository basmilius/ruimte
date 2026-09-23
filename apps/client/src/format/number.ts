import { numberFormatter } from '@/format/locale';

const WHOLE: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };
const ONE_DECIMAL: Intl.NumberFormatOptions = { maximumFractionDigits: 1 };

/* A count as a region groups one: `1,234,567` there, `1.234.567` here. */
export const formatNumber = (value: number): string => numberFormatter(WHOLE).format(Math.round(value));

/* The same, to one decimal, where the fraction is the part that means something. */
export const formatDecimal = (value: number): string => numberFormatter(ONE_DECIMAL).format(value);

/* Percent as Activity Monitor writes it: a decimal under ten, where the difference still shows. */
export const formatPercent = (value: number): string => `${value < 10 ? formatDecimal(value) : formatNumber(value)}%`;

/*
 * The option objects a money formatter is cached on, one per currency and precision. The cache is
 * keyed on the object itself, so building a fresh one per call would build a fresh formatter too.
 */
const moneySpecs = new Map<string, Intl.NumberFormatOptions>();

const moneySpec = (currency: string, maximumFractionDigits: number | undefined): Intl.NumberFormatOptions => {
    const key = `${currency}|${maximumFractionDigits ?? ''}`;
    const known = moneySpecs.get(key);
    if (known !== undefined) {
        return known;
    }
    // Narrow, or a Dutch region writes a dollar amount as `US$ 5.480,96`, which is a currency lesson
    // nobody asked for in a table of prices.
    const spec: Intl.NumberFormatOptions = {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
        ...(maximumFractionDigits ? { maximumFractionDigits } : {})
    };
    moneySpecs.set(key, spec);
    return spec;
};

/* An amount in the currency it is already in, as a bank statement would print it. */
export const formatMoney = (value: number, currency: string, maximumFractionDigits?: number): string =>
    numberFormatter(moneySpec(currency, maximumFractionDigits)).format(value);

const SIGNIFICANT_MONEY: Intl.NumberFormatOptions = { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumSignificantDigits: 3 };

/* Dollars to three significant digits, for amounts that run from a fraction of a cent to tens of dollars in one list. */
export const formatUsdSignificant = (value: number): string => numberFormatter(SIGNIFICANT_MONEY).format(value);

/* `1.2M`, `412K`, `640`: a token count is read as a size, not counted. */
export const formatTokens = (value: number): string => {
    const rounded = Math.round(value);
    if (rounded >= 1_000_000) {
        return `${formatDecimal(rounded >= 10_000_000 ? Math.round(rounded / 1_000_000) : rounded / 1_000_000)}M`;
    }
    if (rounded >= 1_000) {
        return `${formatDecimal(rounded >= 10_000 ? Math.round(rounded / 1_000) : rounded / 1_000)}K`;
    }
    return formatNumber(rounded);
};

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/*
 * A size the way a person says it, with the number in the region's own notation: whole bytes up to
 * a kilobyte, one decimal above that. `whole` is for a column that only has room for a round number.
 */
export const formatBytes = (bytes: number, whole = false): string => {
    let value = Math.max(0, bytes);
    let unit = 0;
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit++;
    }
    const decimals = unit > 0 && !whole && value < 10;
    return `${decimals ? formatDecimal(value) : formatNumber(value)} ${UNITS[unit]}`;
};
