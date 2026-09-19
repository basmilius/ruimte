import { desktop } from '@/desktop/bridge';
import { FORMAT_LANGUAGE, FORMAT_SYSTEM } from '@/format/regions';
import { activeLanguage } from '@/i18n/active';
import { LANGUAGE_REGIONS } from '@/i18n/languages';
import { useSettings } from '@/state/settings';

/* The one locale to fall back on, so a format never depends on which machine ran the test. */
export const FALLBACK_LOCALE = 'en-US';

/* A month and a weekday are words, so they come from the language the interface is in, while the
   order, the separators and the clock come from the region. English words in a Dutch notation is
   what a Dutch Mac running an English app should read like, and both halves are a person's to set. */
export const wordLocale = (): string => activeLanguage();

/* A tag `Intl` will take, or nothing: macOS hands out locales with overrides attached, and a
   formatter built on one it does not know throws where a number was meant to go. */
const usable = (tag: string | undefined): string | null => {
    if (tag === undefined || tag === '') {
        return null;
    }
    try {
        return Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0 ? tag : null;
    } catch {
        return null;
    }
};

/*
 * What the operating system was set to read numbers and dates in. Chromium's own locale is the
 * language of the app bundle, which is English in every build of Ruimte, so a Dutch Mac would still
 * hand back `en-US` and write `08:00 AM`; the shell reads the system's region instead and passes it
 * in. A browser has no such thing, so there the language is the best there is.
 */
export const systemLocale = (): string => {
    const fromShell = usable(desktop()?.systemLocale);
    if (fromShell !== null) {
        return fromShell;
    }
    if (typeof navigator === 'undefined') {
        return FALLBACK_LOCALE;
    }
    return usable(navigator.languages?.[0] ?? navigator.language) ?? FALLBACK_LOCALE;
};

/*
 * The region a language brings with it: the system's own when it already speaks that language, so
 * Dutch in Belgium keeps writing dates the Belgian way, and the country the language is most spoken
 * in when it does not.
 */
const regionOfLanguage = (): string => {
    const language = activeLanguage();
    const system = systemLocale();
    return system.toLowerCase().startsWith(language) ? system : LANGUAGE_REGIONS[language];
};

const resolve = (region: string): string => {
    if (region === FORMAT_LANGUAGE) {
        return regionOfLanguage();
    }
    return region === FORMAT_SYSTEM ? systemLocale() : region;
};

/* The locale every formatter in this folder is built on. Read outside React as well, so it is a
   plain function over the store rather than a hook. */
export const formatLocale = (): string => resolve(useSettings.getState().formatRegion);

/* What a component calls to draw again once the region changes. The value is the locale, which a
   caller may use or ignore; subscribing is the point. */
export const useFormatLocale = (): string => useSettings((s) => resolve(s.formatRegion));

/*
 * A formatter per options object, keyed on the object itself, so a module-level spec builds its
 * formatter once and a list of a thousand rows constructs nothing. A region change throws the entry
 * away, since the locale is part of what was cached.
 */
interface Cached<T> {
    locale: string;
    formatter: T;
}

const cacheFor = <O extends object, T>(store: WeakMap<O, Cached<T>>, options: O, locale: string, build: (locale: string, options: O) => T): T => {
    const hit = store.get(options);
    if (hit !== undefined && hit.locale === locale) {
        return hit.formatter;
    }
    const formatter = build(locale, options);
    store.set(options, { locale, formatter });
    return formatter;
};

const numbers = new WeakMap<Intl.NumberFormatOptions, Cached<Intl.NumberFormat>>();
const dates = new WeakMap<Intl.DateTimeFormatOptions, Cached<Intl.DateTimeFormat>>();
const words = new WeakMap<Intl.DateTimeFormatOptions, Cached<Intl.DateTimeFormat>>();

export const numberFormatter = (options: Intl.NumberFormatOptions): Intl.NumberFormat =>
    cacheFor(numbers, options, formatLocale(), (locale, spec) => new Intl.NumberFormat(locale, spec));

export const dateFormatter = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat =>
    cacheFor(dates, options, formatLocale(), (locale, spec) => new Intl.DateTimeFormat(locale, spec));

/* The same date, written in the language the words come from. Never shown whole: only its month,
   weekday, era and day period are lifted out of it. */
export const wordFormatter = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat =>
    cacheFor(words, options, wordLocale(), (locale, spec) => new Intl.DateTimeFormat(locale, spec));
