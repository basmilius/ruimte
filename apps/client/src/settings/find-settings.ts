import { keyboardGroups } from '@/settings/keyboard-groups';
import { searchSettings, shortcutSearchRows, type SearchResult } from '@/settings/search';

/*
 * The index plus the shortcuts, whose words and keys are only known once the lists are built. It sits
 * apart from the search because the shortcut lists reach the command catalog, which a pure search test must not load.
 */
export function findSettings(query: string, apple: boolean): SearchResult[] {
    return searchSettings(query, query.trim() === '' ? [] : shortcutSearchRows(keyboardGroups(apple), apple));
}
