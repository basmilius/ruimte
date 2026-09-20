import type { FlowCardKind } from '@ruimte/contracts';

/* A card as the picker offers it: the choice it stands for, and the words a person reads on it. */
export interface FlowCardRow {
    kind: FlowCardKind;
    /* The catalog id, absent for a built-in card. */
    card?: string;
    label: string;
    source: string;
    sentence: string;
}

/* The rows under one heading: the cards of a source, or the cards without one. */
export interface FlowCardGroup {
    heading: string;
    rows: FlowCardRow[];
}

const needlesOf = (query: string): string[] =>
    query
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word !== '');

const holds = (text: string, word: string): boolean => text.toLowerCase().includes(word);

/*
 * How near a row is to the query: what a card is called counts for more than what it says, so
 * typing its name puts it on top of every card that merely mentions the word. A row the query
 * misses is -1.
 */
const rankOf = (row: FlowCardRow, needles: readonly string[]): number => {
    if (needles.every((word) => holds(row.label, word))) {
        return 0;
    }
    if (needles.every((word) => holds(`${row.label} ${row.source}`, word))) {
        return 1;
    }
    return needles.every((word) => holds(`${row.label} ${row.source} ${row.sentence}`, word)) ? 2 : -1;
};

/*
 * The rows the query answers, nearest first. Every word has to sit somewhere in the row, so "file
 * changed" finds the card neither word alone names, and nothing is fuzzy: a picker that guesses is
 * one you cannot aim.
 */
export const searchCards = (rows: readonly FlowCardRow[], query: string): FlowCardRow[] => {
    const needles = needlesOf(query);
    if (needles.length === 0) {
        return [...rows];
    }
    const found = rows.map((row) => ({ row, rank: rankOf(row, needles) })).filter((entry) => entry.rank >= 0);
    // A sort in ES2019 and up is stable, so rows of one rank keep the order the catalog gave them.
    found.sort((one, other) => one.rank - other.rank);
    return found.map((entry) => entry.row);
};

/*
 * The rows by where they come from, the sources in the order of the words a person reads and the
 * cards without a source at the end, because those are about the worksheet rather than about
 * anything a machine does.
 */
export const groupCards = (rows: readonly FlowCardRow[], builtInHeading: string, collator: Intl.Collator): FlowCardGroup[] => {
    const bySource = new Map<string, FlowCardRow[]>();
    const builtIn: FlowCardRow[] = [];
    for (const row of rows) {
        if (row.card === undefined) {
            builtIn.push(row);
            continue;
        }
        const held = bySource.get(row.source);
        if (held === undefined) {
            bySource.set(row.source, [row]);
        } else {
            held.push(row);
        }
    }
    const groups = [...bySource].map(([heading, held]) => ({ heading, rows: held }));
    groups.sort((one, other) => collator.compare(one.heading, other.heading));
    if (builtIn.length > 0) {
        groups.push({ heading: builtInHeading, rows: builtIn });
    }
    return groups;
};
