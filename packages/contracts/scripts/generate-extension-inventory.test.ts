import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXTENSION_CALLS_WITHOUT_PERMISSION, EXTENSION_CLIENT_PERMISSIONS } from '../src/extension-client.ts';
import { EXTENSION_SLOT_NAMES } from '../src/extension-vocabularies.generated.ts';
import { checkInventory, inventoryProblems, readInventory, render, rowsOf, scenariosOf } from './generate-extension-inventory.ts';

const DECLARATIONS = `
/** Needs the permission \`clock\`. */
export function schedule(task: { id: string }): void;
export function onEvent<Name extends keyof ServerEvents>(
    name: Name,
    listener: (event: ServerEvents[Name]) => void
): () => void;
export function defineServer<Api>(api: Api): Api;
export function defineServer<Api>(api: Api, more: object): Api;

export interface ServerEvents {
    /** A chat changed. Needs \`chats.read\`. */
    'chat.status': { chat: string };
}

export const files: {
    /** Needs \`files.read\`. */
    peek(path: string): Promise<string>;
    watch(path: string, listener: () => void): Result<() => void>;
};
`;

describe('the rows read from a .d.ts of @ruimte/extension', () => {
    test('are its functions by kind, the members of its areas and its events, an overload once', () => {
        expect(rowsOf('server', DECLARATIONS)).toEqual([
            { id: 'server/call/schedule', permission: 'clock' },
            { id: 'server/call/onEvent', stops: true },
            { id: 'server/provider/defineServer' },
            { id: 'server/call/files.peek', permission: 'files.read' },
            { id: 'server/call/files.watch', permission: 'files.read', stops: true },
            { id: 'server/event/chat.status', permission: 'chats.read' }
        ]);
    });
});

describe('the inventory of the extension API', () => {
    test('is what the generated file holds', async () => {
        expect(readFileSync(join(import.meta.dir, '../src/extension-inventory.generated.ts'), 'utf8')).toBe(render(await readInventory()));
    });

    test('has a row for every slot and every call of the permission tables', async () => {
        const ids = new Set((await readInventory()).map((row) => row.id));
        const named = (name: string): boolean =>
            ['call', 'hook', 'provider'].some((kind) => ids.has(`client/${kind}/${name}`) || ids.has(`server/${kind}/${name}`));

        expect(EXTENSION_SLOT_NAMES.filter((slot) => !ids.has(`client/slot/${slot}`))).toEqual([]);
        expect([...Object.keys(EXTENSION_CLIENT_PERMISSIONS), ...EXTENSION_CALLS_WITHOUT_PERMISSION].filter((call) => !named(call))).toEqual([]);
    });

    test('has a scenario of the contract suite or a known gap for every row', async () => {
        expect(await checkInventory(await readInventory())).toEqual([]);
    });
});

describe('what the inventory asks of the contract suite', () => {
    const rows = { 'client/call/files.watch': { permission: 'files.read', stops: true }, 'client/call/host.copy': {} };
    const scenarios = { client: ['watches', 'refuses', 'stops'], server: ['hears'] };

    test('is nothing for a row with its scenario, its refusal and its cleanup, and one with a reason for its gap', () => {
        const covered = { 'client/call/files.watch': { scenario: 'watches', refusal: 'refuses', cleanup: 'stops' } };

        expect(inventoryProblems(rows, covered, { 'client/call/host.copy': 'No clipboard in a world' }, scenarios)).toEqual([]);
    });

    test('is a scenario for a row in neither list', () => {
        expect(inventoryProblems(rows, {}, { 'client/call/host.copy': 'No clipboard in a world' }, scenarios)).toEqual([
            'client/call/files.watch has no scenario in the contract suite. Add one, or list it as a known gap with the reason.'
        ]);
    });

    test('is the refusal of a row that takes a permission and the cleanup of one that stops', () => {
        const problems = inventoryProblems(
            rows,
            { 'client/call/files.watch': { scenario: 'watches' }, 'client/call/host.copy': { scenario: 'watches' } },
            {},
            scenarios
        );

        expect(problems).toEqual([
            'client/call/files.watch names no refusal: it takes files.read.',
            'client/call/files.watch names no cleanup: it answers a function that stops it.'
        ]);
    });

    test('is a title the suite holds on that side, a reason for every gap, and no row that is gone or in both lists', () => {
        const covered = { 'client/call/host.copy': { scenario: 'hears' }, 'client/call/gone': { scenario: 'watches' } };
        const gaps = { 'client/call/files.watch': ' ', 'client/call/host.copy': 'No clipboard in a world' };

        expect(inventoryProblems(rows, covered, gaps, scenarios)).toEqual([
            'client/call/host.copy has a scenario and is a known gap. Take it off the list of gaps.',
            'client/call/host.copy names a scenario the contract suite does not hold: hears',
            'client/call/gone is no row of the inventory any more. Remove it.',
            'client/call/files.watch is a known gap without a reason.'
        ]);
    });
});

describe('the scenarios of a file of the contract suite', () => {
    test('are the titles of its tests, whatever quotes them', () => {
        const source = [
            "        test('reads a key', async () => {",
            '        test("checks a machine action\'s input", async () => {',
            "    describe('the suite', () => {"
        ];

        expect(scenariosOf(source.join('\n'))).toEqual(['reads a key', "checks a machine action's input"]);
    });
});
