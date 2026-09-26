import { useSyncExternalStore } from 'react';
import { FORMAT_LANGUAGE, FORMAT_SYSTEM } from './regions.ts';

/*
 * Where the formatters read what a person set. The app owns both settings and hands them over once,
 * before the first render; the language writes the words and the region writes the notation.
 */
export interface FormatSource {
    /* The language the interface is written in right now, such as `en` or `nl`. */
    language(): string;
    /* A region tag such as `nl-NL`, or `FORMAT_LANGUAGE` or `FORMAT_SYSTEM`. */
    region(): string;
    /* The system's own locale when a shell can read it; a browser tab falls back on `navigator`. */
    systemLocale?(): string | undefined;
    /* Calls back whenever the language or the region may have changed. */
    subscribe(onChange: () => void): () => void;
}

let source: FormatSource = { language: () => 'en', region: () => FORMAT_LANGUAGE, subscribe: () => () => {} };

/* Answers the source it replaced, so a test can put that one back. */
export const setFormatSource = (next: FormatSource): FormatSource => {
    const previous = source;
    source = next;
    return previous;
};

/* Where a language comes from when nothing else says: the country most of its speakers are in. */
const LANGUAGE_REGIONS: Record<string, string> = { en: 'en-US', nl: 'nl-NL' };

/* The one locale to fall back on, so a format never depends on which machine ran the test. */
export const FALLBACK_LOCALE = 'en-US';

/* A month and a weekday are words, so they come from the language the interface is in, while the
   order, the separators and the clock come from the region. English words in a Dutch notation is
   what a Dutch Mac running an English app should read like, and both halves are a person's to set. */
export const wordLocale = (): string => source.language();

/* A tag `Intl` will take, or nothing. macOS hands out locales with overrides attached, and a
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
    const fromShell = usable(source.systemLocale?.());
    if (fromShell !== null) {
        return fromShell;
    }
    if (typeof navigator === 'undefined') {
        return FALLBACK_LOCALE;
    }
    return usable(navigator.languages?.[0] ?? navigator.language) ?? FALLBACK_LOCALE;
};

/*
 * The region a language brings with it. The system's own when it already speaks that language, so
 * Dutch in Belgium keeps writing dates the Belgian way, and the country the language is most spoken
 * in when it does not.
 */
const regionOfLanguage = (): string => {
    const language = source.language();
    const system = systemLocale();
    return system.toLowerCase().startsWith(language) ? system : (LANGUAGE_REGIONS[language] ?? language);
};

const resolve = (region: string): string => {
    if (region === FORMAT_LANGUAGE) {
        return regionOfLanguage();
    }
    return region === FORMAT_SYSTEM ? systemLocale() : region;
};

/* The locale every formatter in this folder is built on. Read outside React as well, so it is a
   plain function over the source rather than a hook. */
export const formatLocale = (): string => resolve(source.region());

/* What a component calls to draw again once the region changes. The value is the locale, which a
   caller may use or ignore; subscribing is the point. */
const subscribe = (onChange: () => void): (() => void) => source.subscribe(onChange);

export const useFormatLocale = (): string => useSyncExternalStore(subscribe, formatLocale, formatLocale);

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

const collators = new Map<string, Intl.Collator>();

/*
 * How two labels a person reads are put in order. Labels are words, so the language writes them and
 * the language sorts them: Dutch puts Tekening after Terminal where English puts Drawing before it.
 * Keyed on the locale rather than on an options object, since there are no options to key on.
 */
export const labelCollator = (): Intl.Collator => {
    const locale = wordLocale();
    const held = collators.get(locale);
    if (held !== undefined) {
        return held;
    }
    const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
    collators.set(locale, collator);
    return collator;
};
