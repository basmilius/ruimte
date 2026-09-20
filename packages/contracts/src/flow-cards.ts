import { z } from 'zod';
import type { FlowArgValue, FlowCardKind } from './flow.ts';

/*
 * Where a card's signal comes from, which is the small line a card carries above its sentence. A
 * source earns its place once a card uses it, so this list grows with the catalog.
 */
export const FlowCardSourceSchema = z.enum(['time', 'files', 'text', 'chat', 'person']);
export type FlowCardSource = z.infer<typeof FlowCardSourceSchema>;

/*
 * What a field on a card holds. `path` is relative to the project folder, `time` is `HH:MM` on the
 * machine that runs the flow, and `chat` is a chat node in the project.
 */
export const FlowArgTypeSchema = z.enum(['text', 'longText', 'number', 'boolean', 'choice', 'time', 'path', 'chat']);
export type FlowArgType = z.infer<typeof FlowArgTypeSchema>;

export interface FlowArgDefinition {
    name: string;
    type: FlowArgType;
    /* Absent reads as required: a run refuses a card whose required field is empty. */
    optional?: true;
    /* The values a `choice` field offers, in the order the editor shows them. */
    choices?: readonly string[];
    /* What a new card starts with. */
    value?: FlowArgValue;
    /* Only shown, and only read, while another field on the card holds one of these values. */
    when?: { arg: string; is: readonly string[] };
    /* Whether a token may stand in the text a person types here. */
    tokens?: true;
}

/* What a card hands the cards after it. The example fills the popup when a test starts halfway down. */
export interface FlowTokenDefinition {
    name: string;
    type: 'text' | 'number' | 'boolean';
    example: FlowArgValue;
}

export interface FlowCardDefinition {
    /* `<source>.<what>`, which is also the key the interface reads its words under. */
    id: string;
    kind: 'trigger' | 'condition' | 'action';
    source: FlowCardSource;
    args: readonly FlowArgDefinition[];
    tokens: readonly FlowTokenDefinition[];
    /*
     * Whether this card can fail in a way a flow could take another path over. Only then does it get
     * an `error` port beside `done`. It sits here rather than in a list somewhere else, because a
     * list elsewhere is a list that goes stale the first time someone adds a card.
     */
    fails?: true;
    /*
     * What a dry test run does with this card. Absent reads as dry: a card that says nothing about
     * itself is written down rather than carried out, which is the safe way round.
     */
    test?: 'real' | 'skip';
}

/*
 * Every card with a source behind it. The catalog is the one place that says what a card takes and
 * what it hands on, so the editor builds its fields from here and the daemon reads the same table.
 */
export const FLOW_CARDS: readonly FlowCardDefinition[] = [
    {
        id: 'time.at',
        kind: 'trigger',
        source: 'time',
        args: [
            { name: 'every', type: 'choice', choices: ['day', 'weekday', 'minutes'], value: 'day' },
            { name: 'at', type: 'time', value: '08:00', when: { arg: 'every', is: ['day', 'weekday'] } },
            { name: 'minutes', type: 'number', value: 15, when: { arg: 'every', is: ['minutes'] } }
        ],
        tokens: [
            { name: 'time', type: 'text', example: '08:00' },
            { name: 'day', type: 'text', example: 'Monday' }
        ]
    },
    {
        id: 'files.changed',
        kind: 'trigger',
        source: 'files',
        // A folder matches everything under it, so one card covers a file and a tree both.
        args: [{ name: 'path', type: 'path', value: 'README.md' }],
        tokens: [
            { name: 'path', type: 'text', example: 'README.md' },
            { name: 'content', type: 'text', example: 'The text of the file that changed' }
        ]
    },
    {
        id: 'text.contains',
        kind: 'condition',
        source: 'text',
        args: [
            { name: 'text', type: 'text', tokens: true },
            { name: 'value', type: 'text' },
            { name: 'mode', type: 'choice', choices: ['contains', 'matches'], value: 'contains' }
        ],
        tokens: []
    },
    {
        id: 'person.notify',
        kind: 'action',
        source: 'person',
        args: [{ name: 'text', type: 'text', tokens: true }],
        tokens: [],
        // Harmless, and whether the text reads right is the whole question a test answers.
        test: 'real'
    },
    {
        id: 'chat.message',
        kind: 'action',
        source: 'chat',
        args: [
            { name: 'chat', type: 'chat' },
            { name: 'text', type: 'longText', tokens: true }
        ],
        tokens: [],
        // The chat may have been deleted since the flow was drawn, and that deserves its own path.
        fails: true
    }
];

const BY_ID = new Map(FLOW_CARDS.map((definition) => [definition.id, definition]));

/* The card in the catalog under this id, or null for an id this build does not know. */
export const flowCardDefinition = (id: string): FlowCardDefinition | null => BY_ID.get(id) ?? null;

export type FlowBuiltInKind = Extract<FlowCardKind, 'start' | 'delay' | 'any' | 'all' | 'note'>;

export interface FlowBuiltInDefinition {
    args: readonly FlowArgDefinition[];
    tokens: readonly FlowTokenDefinition[];
}

/* The cards without a source, which only say something about the graph itself. */
export const FLOW_BUILT_INS: Record<FlowBuiltInKind, FlowBuiltInDefinition> = {
    start: { args: [], tokens: [{ name: 'input', type: 'text', example: 'what I typed' }] },
    delay: {
        args: [
            { name: 'amount', type: 'number', value: 30 },
            { name: 'unit', type: 'choice', choices: ['seconds', 'minutes', 'hours'], value: 'seconds' }
        ],
        tokens: []
    },
    any: { args: [], tokens: [] },
    all: { args: [], tokens: [] },
    note: { args: [{ name: 'text', type: 'longText' }], tokens: [] }
};
