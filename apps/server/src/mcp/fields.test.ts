import { describe, expect, test } from 'bun:test';
import { argvOf, fieldKey, shortText, SWITCH_ON, withFieldNames, type ToolField } from './fields.ts';

const FIELDS: ToolField[] = [
    { key: 'node_id', kind: 'positional', flag: 'nodeId', required: true, schema: { type: 'string' } },
    { key: 'name', kind: 'positional', flag: 'name', required: false, schema: { type: 'string' } },
    { key: 'text', kind: 'flag', flag: 'text', required: false, schema: { type: 'string' } },
    { key: 'cols', kind: 'flag', flag: 'cols', required: false, schema: { type: 'integer' } },
    { key: 'dry_run', kind: 'switch', flag: 'dry-run', required: false, schema: { type: 'boolean' } },
    { key: 'state', kind: 'state', flag: 'state', required: false, schema: { type: 'string', enum: [SWITCH_ON, 'full'] } }
];

describe('argvOf', () => {
    test('positionals come first in their order, then every flag with its value after =', () => {
        expect(argvOf(FIELDS, { text: '--not a flag', node_id: 'n1', name: 'Two words', cols: 3 })).toEqual([
            'n1',
            'Two words',
            '--text=--not a flag',
            '--cols=3'
        ]);
    });

    test('a positional after a missing one is left out, so no later one slides into its place', () => {
        expect(argvOf(FIELDS, { name: 'orphan' })).toEqual([]);
    });

    test('a switch is written only when true', () => {
        expect(argvOf(FIELDS, { node_id: 'n1', dry_run: true })).toEqual(['n1', '--dry-run']);
        expect(argvOf(FIELDS, { node_id: 'n1', dry_run: false })).toEqual(['n1']);
    });

    test('a switch that takes a value is bare for on and spelled out for the rest', () => {
        expect(argvOf(FIELDS, { node_id: 'n1', state: SWITCH_ON })).toEqual(['n1', '--state']);
        expect(argvOf(FIELDS, { node_id: 'n1', state: 'full' })).toEqual(['n1', '--state=full']);
    });

    test('a variadic field spreads over the last positionals and a list elsewhere joins with commas', () => {
        const fields: ToolField[] = [
            { key: 'step_id', kind: 'variadic', flag: 'stepId', required: true, schema: { type: 'array', items: { type: 'string' } } },
            { key: 'nodes', kind: 'flag', flag: 'nodes', required: false, schema: { type: 'string' } }
        ];

        expect(argvOf(fields, { step_id: ['s1', 's2'], nodes: ['a', 'b'] })).toEqual(['s1', 's2', '--nodes=a,b']);
    });

    test('an escaped flag doubles its backslashes, so the verb reads them back as typed', () => {
        expect(argvOf(FIELDS, { node_id: 'n1', text: 'a\\nb\nc' }, new Set(['text']))).toEqual(['n1', '--text=a\\\\nb\nc']);
    });
});

describe('names and texts', () => {
    test('a field key is snake case', () => {
        expect(fieldKey('nodeId')).toBe('node_id');
        expect(fieldKey('request-id')).toBe('request_id');
    });

    test('a help text keeps its first clause and names flags by their field', () => {
        expect(shortText('Only the last N lines; without it the whole source')).toBe('Only the last N lines');
        expect(shortText('With --worktree: the branch to use')).toBe('With worktree: the branch to use');
        expect(withFieldNames('link_new --to X --request-id R, not a--b')).toBe('link_new to X request_id R, not a--b');
    });
});
