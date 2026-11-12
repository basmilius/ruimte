import { matchScore } from '@adecore/ui';
import type { Command } from '@/commands/behavior';
import type { SearchResult } from '@/settings/search';
import { sectionLabel } from '@/settings/sections';
import { useUi } from '@/state/ui';

/* Enough to find a setting by a loose word without burying the commands under the rows of one pane. */
const SETTINGS_RESULTS = 6;

const PREFIX = 5;

/* Rows go ahead of panes: Enter on a word that names a row should land on that row, not on the pane around it.
   A row hints at its pane, since two panes can hold a row of the same name; a pane has only its own description. */
export function settingsEntries(results: readonly SearchResult[]): Command[] {
    const rowsFirst = [...results.filter((result) => result.id !== null), ...results.filter((result) => result.id === null)];
    return rowsFirst.slice(0, SETTINGS_RESULTS).map((result) => ({
        id: `setting-${result.section}-${result.id ?? 'pane'}`,
        label: result.label,
        hint: result.id === null ? result.description : sectionLabel(result.section),
        run: () => useUi.getState().setSettings({ open: true, section: result.section, target: result.id })
    }));
}

export function namesSetting(query: string, settings: readonly Command[]): boolean {
    return settings.some((setting) => matchScore(setting.label, query) === PREFIX);
}

/* Projects come first. A setting the query names only outranks the files, which match the letters loosely; otherwise settings stay last. */
export function orderBelowJumps<T>({ named, settings, files, rest }: { named: boolean; settings: readonly T[]; files: readonly T[]; rest: readonly T[] }): T[] {
    return named ? [...rest, ...settings, ...files] : [...files, ...rest, ...settings];
}
