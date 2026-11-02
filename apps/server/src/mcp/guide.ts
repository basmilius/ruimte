import type { Action, VerbEntry } from '../canvas/verb.ts';
import { withFieldNames } from './fields.ts';

interface GuideTopic {
    /* The registry name of the verb or action whose help holds the format. */
    entry: string;
    /* The kinds of its help rows that describe the format. */
    rows: readonly string[];
    /* Flags whose whole help row belongs to it. */
    flags?: readonly string[];
}

/*
 * The input formats a tool takes as text, kept out of the schemas so the tool list stays small. Each is
 * read off the help of the verb that parses it, so the guide and the verb never drift apart.
 */
export const GUIDE_TOPICS: Readonly<Record<string, GuideTopic>> = {
    diagram: { entry: 'view diagram', rows: ['document', 'field', 'layout', 'replace', 'strict', 'rules', 'limits', 'example'] },
    drawing: {
        entry: 'view drawing',
        rows: ['edit', 'add', 'kind', 'update', 'remove', 'colors', 'coordinates', 'revision', 'undo', 'locked', 'strict', 'limits', 'example']
    },
    plan: { entry: 'plan new', rows: ['document', 'field', 'strict', 'limits', 'example'], flags: ['markdown'] },
    nodes: { entry: 'node new', rows: ['kind', 'many', 'example'] },
    notes: { entry: 'node edit', rows: ['many', 'example'] },
    roles: { entry: 'team', rows: ['roles', 'json'] },
    models: { entry: 'agent', rows: ['model'] },
    schedule: { entry: 'routine new', rows: [], flags: ['at'] }
};

function entryNamed(entries: readonly VerbEntry[], name: string): VerbEntry | Action | undefined {
    for (const entry of entries) {
        if (entry.name === name) {
            return entry;
        }

        const action = entry.served === 'noun' ? entry.actions.find((candidate) => candidate.name === name) : undefined;

        if (action !== undefined) {
            return action;
        }
    }

    return undefined;
}

/* An example row as the CLI wrote it, `node_new --json '[...]'`, keeps only the JSON a field takes. */
function exampleText(text: string): string {
    const quoted = /'([[{].*[\]}])'/.exec(text);

    return quoted?.[1] ?? text;
}

/* The help rows of one topic, with every flag written as the field that carries it. */
export function guideLines(topic: string, entries: readonly VerbEntry[], rewrite: (text: string) => string): string[] {
    const guide = GUIDE_TOPICS[topic];
    const entry = guide === undefined ? undefined : entryNamed(entries, guide.entry);

    if (guide === undefined || entry === undefined) {
        return [];
    }

    const flags = new Set((guide.flags ?? []).map((flag) => `--${flag}`));

    return entry.detail
        .filter((line) => {
            const [kind = '', syntax = ''] = line.split('\t');

            return guide.rows.includes(kind) || (kind === 'flag' && flags.has(syntax.split(/[ =]/)[0]!));
        })
        .map((line) => {
            const [kind = '', ...rest] = line.split('\t');

            if (kind === 'flag') {
                // A flag row as the field it is: its name and its text, without the CLI's syntax and need.
                return withFieldNames(rewrite(`${rest[0]!.split(/[ =]/)[0]}\t${rest.at(-1)}`));
            }

            return withFieldNames(rewrite([kind, ...(kind === 'example' ? [exampleText(rest.join('\t'))] : rest)].join('\t')));
        });
}
