import { formatShortcut } from '@adecore/ui';
import i18next from 'i18next';
import { settingsSectionRegistry, type SettingsSearchRow } from '@/registry/settings-sections';
import { allSettingsSections, sectionDescription, sectionLabel } from '@/settings/sections';
import { shortcutRowId, type ShortcutGroup } from '@/settings/shortcuts';
import { useContributions } from '@/state/extension-registry';
import type { SettingsSectionId } from '@/state/ui';

/*
 * The rows a search can find: each section names its own (`registry/settings-sections.ts`), since a pane draws
 * only while it is open and the rows cannot be read off the screen.
 */
export function settingsIndex(): readonly SettingsSearchRow[] {
    return settingsSectionRegistry.all().flatMap((section) => section.rows);
}

export interface SearchResult {
    section: SettingsSectionId;
    /* English words that also find this result without being shown; set only outside English. */
    english?: string;
    id: string | null;
    label: string;
    description: string;
}

/* Case and accents fold away, so "e" finds "é" and a capital in the query changes nothing. */
function fold(text: string): string {
    return text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
}

function withoutBraces(text: string): string {
    return text.replace(/\{\{\w+\}\}/g, '').trim();
}

// An interpolation the index cannot fill in reads as nothing rather than as its braces.
function words(key: string): string {
    return withoutBraces(i18next.t(key));
}

/* The English words of a key, or nothing where the interface already speaks English or the key has no English. */
function englishWords(key: string | undefined): string {
    if (key === undefined || i18next.language.startsWith('en') || !i18next.exists(key, { lng: 'en' })) {
        return '';
    }
    return withoutBraces(i18next.getFixedT('en')(key));
}

function matches(terms: readonly string[], ...texts: string[]): boolean {
    const haystack = fold(texts.join(' '));
    return terms.every((term) => haystack.includes(term));
}

export function shortcutSearchRows(groups: readonly ShortcutGroup[], apple: boolean): SearchResult[] {
    return groups.flatMap((group) =>
        group.shortcuts.map((row, index) => ({
            section: 'keyboard' as const,
            id: shortcutRowId(group.id, index),
            label: row.label,
            description: i18next.t('settings:keyboard.result', {
                category: group.title,
                keys: [formatShortcut(row.keys, apple), ...(row.then ? [row.then] : [])].join(' ')
            })
        }))
    );
}

function sectionEnglish(id: SettingsSectionId): string {
    const contributed = useContributions.getState().settingsSections.find((section) => section.id === id);

    return contributed === undefined
        ? `${englishWords(`settings:sections.${id}.label`)} ${englishWords(`settings:sections.${id}.description`)}`
        : `${englishWords(contributed.labelKey)} ${englishWords(contributed.descriptionKey)}`;
}

/* `built` holds the rows whose words exist only at run time, like the shortcuts. */
export function searchSettings(query: string, built: readonly SearchResult[] = []): SearchResult[] {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
        return [];
    }
    const sections = allSettingsSections();
    const contributed = useContributions.getState().settingsSections;
    const panes = sections
        .map((meta) => ({
            section: meta.id,
            id: null,
            label: sectionLabel(meta.id),
            description: sectionDescription(meta.id),
            english: sectionEnglish(meta.id)
        }))
        .filter((result) => matches(terms, result.label, result.description, result.english));
    const order = sections.map((meta) => meta.id);
    const contributedRows = contributed.flatMap((section) =>
        (section.search ?? []).map((row) => ({
            section: section.id,
            id: row.id,
            label: words(row.label),
            description: words(row.description),
            english: `${englishWords(row.label)} ${englishWords(row.description)}`
        }))
    );
    const indexed = settingsIndex()
        .filter((entry) => entry.available?.() ?? true)
        .map((entry) => ({
            section: entry.section,
            id: entry.id,
            label: words(entry.label),
            description: entry.description ? words(entry.description) : '',
            english: `${englishWords(entry.label)} ${englishWords(entry.description)}`
        }));
    const rows = [...indexed, ...contributedRows, ...built]
        .filter((result) => matches(terms, result.label, result.description, result.english ?? ''))
        .sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
    return [...panes, ...rows];
}
