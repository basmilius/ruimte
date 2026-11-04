import { matchScore, type CommandPaletteInputProps, type CommandPaletteVirtualItemProps } from '@adecore/ui';
import type { ReactNode } from 'react';
import type { Command } from '@/shell/commands';

export interface Entry extends Command {
    icon: ReactNode;
    /* Set on a jump row for a node of the view on screen; an empty palette offers only those. */
    here?: boolean;
    /* Pushed to the end of the row, where a state belongs: the hint next to a name is about the name. */
    trailing?: ReactNode;
    /* What Cmd-click or Cmd+Enter (Ctrl off macOS) does instead of `run`, such as a project in a window of its own. */
    inNewWindow?: () => void;
    section: 'recent' | 'jump' | 'files' | 'views' | 'projects' | 'actions' | 'extensions' | 'settings' | 'folders' | 'machines';
    /* The folder a browse row stands for: what Enter steps into, and what Tab completes the field
       to without stepping in. Navigating is the palette's own business, so such a row has no `run`. */
    browsePath?: string;
    /* What the row also answers to without showing it, such as the title and the address of a page. */
    keywords?: string;
}

/* What the palette shares with the mode on screen: the field. */
export interface PaletteContext {
    open: boolean;
    query: string;
    setQuery(query: string): void;
    close(): void;
}

export type PaletteKeyEvent = Parameters<NonNullable<CommandPaletteInputProps['onKeyDown']>>[0];

/* Base UI tells the rows apart by the object, which a mode builds again on every render; the palette by `id`. */
export interface PaletteRow {
    id: string;
}

/* Base UI drops a group without rows, label and all. */
export interface PaletteGroup<Row extends PaletteRow> {
    value: string;
    label: ReactNode;
    items: readonly Row[];
}

/* One mode of the palette as the body draws it around the one field every mode shares. */
export interface PaletteModeView<Row extends PaletteRow = PaletteRow> {
    groups: readonly PaletteGroup<Row>[];
    virtualized?: boolean;
    /* A row of `groups` as a `CommandPalette.Item` keyed by its id, with the row as its value. */
    item(row: Row, itemProps?: CommandPaletteVirtualItemProps): ReactNode;
    /* A key before Base UI's own, which clicks the highlighted row on Enter. */
    keyDown?(event: PaletteKeyEvent, highlighted: Row | undefined): void;
    /* Backspace in an empty field. */
    back?(): void;
    leading?: ReactNode;
    trailing?: ReactNode;
    /* What the list says while it has no rows. */
    empty?: ReactNode;
    /* Read out as it changes, under the rows. */
    status?: ReactNode;
    footer?: ReactNode;
}

/* Every typed word somewhere in the text, in any order. An empty query scores 0 and keeps everything; 1 is only letters in order. */
export function matches(query: string, text: string): boolean {
    const score = matchScore(text, query);
    return score !== null && score !== 1;
}

/* Whether a row answers to the query, by what it shows and by what it only answers to. */
export function entryMatches(query: string, entry: Pick<Entry, 'label' | 'hint' | 'keywords'>): boolean {
    return matches(query, [entry.label, entry.hint, entry.keywords].filter(Boolean).join(' '));
}

/* A browser shows a page a person knows by its title and its address, not by the name of the node. */
export function pageKeywords(url: string | undefined, page: { url: string; title: string } | undefined): string {
    return [url, page?.url, page?.title].filter(Boolean).join(' ');
}

/* The rows of a list mode under the label of each section they fall in, in the order they come. */
export function groupBySection(entries: readonly Entry[], label: (section: Entry['section']) => string): PaletteGroup<Entry>[] {
    const groups: { section: Entry['section']; items: Entry[] }[] = [];
    for (const entry of entries) {
        const last = groups.at(-1);
        if (last?.section === entry.section) {
            last.items.push(entry);
        } else {
            groups.push({ section: entry.section, items: [entry] });
        }
    }
    return groups.map((group, index) => ({ value: `${group.section}-${index}`, label: label(group.section), items: group.items }));
}
