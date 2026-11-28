import type { Json } from '@ruimte/extension/client';

export const CARD_NODE = 'card';
export const COLUMNS = ['Todo', 'Doing', 'Done'] as const;

export interface CardData {
    title: string;
    column: string;
    points: number;
}

export interface Board {
    name: string;
    columns: { name: string; cards: { title: string; points: number }[] }[];
}

export const NEW_CARD: CardData = { title: 'New card', column: COLUMNS[0], points: 1 };

/* A card of version 1 was its title alone. One that already holds a title is kept as it is. */
export function migrateCard(stored: Json): CardData {
    if (typeof stored === 'string') {
        return { ...NEW_CARD, title: stored };
    }

    return stored !== null && typeof stored === 'object' && !Array.isArray(stored) && typeof stored.title === 'string'
        ? ({ ...NEW_CARD, ...stored } as CardData)
        : NEW_CARD;
}

export function nextColumn(column: string): string {
    const at = COLUMNS.indexOf(column as (typeof COLUMNS)[number]);

    return COLUMNS[(at + 1) % COLUMNS.length] as string;
}

/* A board from flat cards, in the order of its columns. */
export function boardOf(name: string, columns: readonly string[], cards: readonly CardData[]): Board {
    return {
        name,
        columns: columns.map((column) => ({
            name: column,
            cards: cards.filter((card) => card.column === column).map(({ title, points }) => ({ title, points }))
        }))
    };
}

/*
 * A board as a `.board` file and a `board` block write it: a `# name` line, then a line per column,
 * `Doing: Search by number (3), Write the import (5)`. Points are optional and one without them.
 */
export function parseBoard(text: string): Board {
    const board: Board = { name: '', columns: [] };

    for (const line of text.split('\n').map((each) => each.trim())) {
        if (line.startsWith('#')) {
            board.name = line.replace(/^#+\s*/, '');

            continue;
        }

        const colon = line.indexOf(':');

        if (colon === -1) {
            continue;
        }

        board.columns.push({
            name: line.slice(0, colon).trim(),
            cards: line
                .slice(colon + 1)
                .split(',')
                .map((card) => card.trim())
                .filter((card) => card !== '')
                .map((card) => {
                    const points = /^(.*)\((\d+)\)$/.exec(card);

                    return points === null ? { title: card, points: 1 } : { title: (points[1] as string).trim(), points: Number(points[2]) };
                })
        });
    }

    return board;
}

export function boardText(board: Board): string {
    const columns = board.columns.map((column) => `${column.name}: ${column.cards.map((card) => `${card.title} (${card.points})`).join(', ')}`);

    return [`# ${board.name}`, ...columns, ''].join('\n');
}

/* The titles of the cards a diff of a `.board` file adds and takes away; a card that only moved is in neither. */
export function cardChanges(diff: string): { added: string[]; removed: string[] } {
    const titles = (sign: string): string[] =>
        diff
            .split('\n')
            .filter((line) => line.startsWith(sign) && !line.startsWith(sign.repeat(3)))
            .flatMap((line) => parseBoard(line.slice(1)).columns.flatMap((column) => column.cards.map((card) => card.title)));

    const after = titles('+');
    const before = titles('-');

    return { added: after.filter((title) => !before.includes(title)), removed: before.filter((title) => !after.includes(title)) };
}
