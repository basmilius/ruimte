/* The Boardwalk service, as this extension would reach it over the network: fixed boards in memory. */

export interface ServiceCard {
    title: string;
    column: string;
    points: number;
}

export interface ServiceBoard {
    id: string;
    name: string;
    columns: string[];
    cards: ServiceCard[];
}

const COLUMNS = ['Todo', 'Doing', 'Done'];

export const BOARDS: readonly ServiceBoard[] = [
    {
        id: 'sprint-12',
        name: 'Sprint 12',
        columns: COLUMNS,
        cards: [
            { title: 'Import invoices from a file', column: 'Todo', points: 5 },
            { title: 'Empty state for the report', column: 'Todo', points: 2 },
            { title: 'Search by invoice number', column: 'Doing', points: 3 },
            { title: 'Time zone of the account', column: 'Done', points: 1 }
        ]
    },
    {
        id: 'launch',
        name: 'Launch',
        columns: COLUMNS,
        cards: [
            { title: 'Write the announcement', column: 'Todo', points: 2 },
            { title: 'Record the walkthrough', column: 'Doing', points: 3 }
        ]
    }
];
