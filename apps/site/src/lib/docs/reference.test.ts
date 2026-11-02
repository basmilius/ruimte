import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDeclarations, slotsOf } from './reference.ts';
import { referenceModules } from './reference-source.ts';

describe('the reference', () => {
    test('matches the types of @ruimte/extension; run `bun run --cwd apps/docs reference` after changing them', () => {
        const committed = JSON.parse(readFileSync(join(import.meta.dir, '../../generated/reference.json'), 'utf8'));

        expect(committed).toEqual(referenceModules());
    });

    test('keeps the doc above a declaration, joins overloads and ignores brackets in comments', () => {
        const entries = parseDeclarations(`import type { X } from 'x';

/** Opens a thing (the first one. */
export function open(id: string): void;
export function open(): void;

export const host: {
    /** Asks (once. */
    ask(question: string): Promise<boolean>;
};

export * from '@adecore/ui';
`);

        expect(entries.map(({ name, kind, doc }) => ({ name, kind, doc }))).toEqual([
            { name: 'open', kind: 'function', doc: 'Opens a thing (the first one.' },
            { name: 'host', kind: 'const', doc: null },
            { name: '@adecore/ui', kind: 'export', doc: null }
        ]);
        expect(entries[0]?.code).toBe('export function open(id: string): void;\nexport function open(): void;');
    });

    test('lists every slot with what it tells', () => {
        const client = referenceModules().find((module) => module.module === 'client');
        const slots = slotsOf(client?.entries ?? []);

        expect(slots.find((slot) => slot.name === 'nodeMenu')).toEqual({
            name: 'nodeMenu',
            context: '{ node: NodeInfo; nodes: NodeInfo[] }',
            doc: '`nodes` is the selection if the node is in it.'
        });
        expect(slots.length).toBeGreaterThan(30);
    });
});
