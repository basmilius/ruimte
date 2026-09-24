/*
 * The regions a person can read this app in, beside the one its language comes with and the one the
 * operating system was set to. The list is short on purpose. It is here for a machine whose region
 * reads nothing like the person in front of it, not as a country picker.
 */
export const FORMAT_LANGUAGE = 'language';
export const FORMAT_SYSTEM = 'system';

/* Only the tags. A country names itself in the language the interface is in (`Intl.DisplayNames`),
   so no translation file ever carries a list of countries. */
export const FORMAT_REGIONS = ['nl-NL', 'en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'sv-SE', 'ja-JP'] as const;

export const FORMAT_REGION_CHOICES: readonly string[] = [FORMAT_LANGUAGE, FORMAT_SYSTEM, ...FORMAT_REGIONS];

/* The country of a region tag, named in `language`: `nl-NL` in English is "Netherlands". */
export const regionName = (region: string, language: string): string =>
    new Intl.DisplayNames([language], { type: 'region' }).of(region.slice(region.indexOf('-') + 1)) ?? region;

/* A stored region, or the language's own for anything this version does not offer. */
export const formatRegionFrom = (stored: unknown): string => FORMAT_REGION_CHOICES.find((region) => region === stored) ?? FORMAT_LANGUAGE;
