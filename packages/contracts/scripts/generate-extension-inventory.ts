/*
 * Writes the inventory of the extension API: one row for every call, hook, provider, slot and event the `.d.ts` files of
 * `@ruimte/extension` declare and for every field of a manifest, with the permission a row takes and whether it hands
 * back something that stops it. `--check` fails on a stale file, and on a row the contract suite neither holds in a
 * scenario nor lists as a known gap (`extensions/poc/contract/contract/inventory.ts`), so a call the API gains cannot
 * land without one.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { EXTENSION_CLIENT_PERMISSIONS } from '../src/extension-client.ts';
import { ExtensionManifestSchema } from '../src/extension.ts';

const ROOT = join(import.meta.dir, '..', '..', '..');
const EXTENSION = join(ROOT, 'packages', 'extension');
const OUTPUT = join(ROOT, 'packages', 'contracts', 'src', 'extension-inventory.generated.ts');
const CONTRACT = join(ROOT, 'extensions', 'poc', 'contract', 'contract');

export type InventorySide = 'client' | 'server' | 'manifest';
export type InventoryKind = 'call' | 'hook' | 'provider' | 'slot' | 'event' | 'contribution';

export interface InventoryRow {
    /* `<side>/<kind>/<name>`. */
    id: string;
    permission?: string;
    /* It answers a function that stops it, so a scenario has to stop it too. */
    stops?: true;
}

function kindOf(name: string): InventoryKind {
    if (name.startsWith('define')) {
        return 'provider';
    }

    return /^use[A-Z]/.test(name) ? 'hook' : 'call';
}

function permissionIn(doc: string): string | undefined {
    return /Needs (?:the permission )?`([\w.]+)`/.exec(doc)?.[1];
}

/* The keys of an `export interface Name {` whose members are objects, each with the doc comment above it. */
function membersOf(declarations: string, name: string): { key: string; doc: string }[] {
    const body = new RegExp(`export interface ${name} \\{\\n([\\s\\S]*?)\\n\\}`).exec(declarations)?.[1];

    if (body === undefined) {
        throw new Error(`No ${name} found`);
    }

    return [...body.matchAll(/((?:^ {4}\/\*\*[\s\S]*?\*\/\n)?)^ {4}(?:'([\w.]+)'|(\w+)): /gm)].map((match) => ({
        key: (match[2] ?? match[3]) as string,
        doc: match[1] ?? ''
    }));
}

/*
 * The rows a `.d.ts` of `@ruimte/extension` declares: its `export function`s, the members of its `export const area: {`
 * objects, and its events. A declaration counts once, whatever its overloads.
 */
export function rowsOf(side: 'client' | 'server', declarations: string): InventoryRow[] {
    const rows = new Map<string, InventoryRow>();
    const add = (kind: InventoryKind, name: string, permission: string | undefined, stops: boolean): void => {
        const id = `${side}/${kind}/${name}`;

        if (!rows.has(id)) {
            rows.set(id, { id, ...(permission === undefined ? {} : { permission }), ...(stops ? { stops: true } : {}) });
        }
    };
    const lines = declarations.split('\n');
    let area: string | null = null;
    let doc = '';
    let inDoc = false;

    lines.forEach((line, at) => {
        const trimmed = line.trim();

        if (inDoc || trimmed.startsWith('/**')) {
            doc = inDoc ? `${doc} ${trimmed}` : trimmed;
            inDoc = !trimmed.endsWith('*/');

            return;
        }

        const documented = permissionIn(doc);
        const open = /^export const (\w+): \{$/.exec(line);
        const name = area === null ? /^export function (\w+)/.exec(line)?.[1] : /^ {4}(\w+)[(<]/.exec(line)?.[1];

        doc = '';

        if (open !== null) {
            area = open[1] as string;
        } else if (line === '};') {
            area = null;
        } else if (name !== undefined) {
            const call = area === null ? name : `${area}.${name}`;
            // A declaration ends on the first line that closes it at its own depth.
            const last = line.endsWith(';') ? line : (lines.slice(at + 1).find((each) => each.startsWith(area === null ? ')' : '    )')) ?? line);

            add(
                area === null ? kindOf(name) : 'call',
                call,
                EXTENSION_CLIENT_PERMISSIONS[call] ?? documented,
                /\): (?:Result<\(\) => void>|\(\) => void);$/.test(last)
            );
        }
    });

    for (const event of membersOf(declarations, side === 'client' ? 'ClientEvents' : 'ServerEvents')) {
        add('event', event.key, permissionIn(event.doc), false);
    }

    if (side === 'client') {
        for (const slot of membersOf(declarations, 'SlotContexts')) {
            add('slot', slot.key, undefined, false);
        }
    }

    return [...rows.values()];
}

/* What a manifest may hold, read from its schema. */
export function manifestRows(): InventoryRow[] {
    return Object.keys(ExtensionManifestSchema.shape).map((field) => ({ id: `manifest/contribution/${field}` }));
}

export function render(rows: readonly InventoryRow[]): string {
    const lines = rows
        // By code unit, so the file is the same under every locale.
        .toSorted((left, right) => (left.id < right.id ? -1 : 1))
        .map((row) => {
            const fields = [row.permission === undefined ? null : `permission: '${row.permission}'`, row.stops === true ? 'stops: true' : null].filter(Boolean);

            return `    '${row.id}': ${fields.length === 0 ? '{}' : `{ ${fields.join(', ')} }`}`;
        });

    return [
        '// Generated from packages/extension/client.d.ts, server.d.ts and the manifest schema by packages/contracts/scripts/generate-extension-inventory.ts. Do not edit.',
        '',
        '/*',
        ' * Every call, hook, provider, slot and event of `@ruimte/extension` and every field of a manifest, as `<side>/<kind>/<name>`:',
        ' * the permission it takes, and whether it answers a function that stops it.',
        ' */',
        'export const EXTENSION_API_INVENTORY = {',
        lines.join(',\n'),
        '} as const;',
        ''
    ].join('\n');
}

/* The titles of the scenarios a file of the contract suite holds. */
export function scenariosOf(source: string): string[] {
    return [...source.matchAll(/^\s+test\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gm)].map((match) => (match[2] as string).replaceAll(/\\(.)/g, '$1'));
}

export interface Coverage {
    /* The scenario that uses it, by its title in the contract suite. */
    scenario: string;
    /* The scenario that asks without the permission, for a row that takes one. */
    refusal?: string;
    /* The scenario that stops it, for a row that answers a function that does. */
    cleanup?: string;
}

/* Why the inventory and the contract suite do not agree, one line each; none when every row is accounted for. */
export function inventoryProblems(
    rows: Readonly<Record<string, { permission?: string; stops?: boolean }>>,
    covered: Readonly<Record<string, Coverage>>,
    gaps: Readonly<Record<string, string>>,
    scenarios: Readonly<Record<'client' | 'server', readonly string[]>>
): string[] {
    const problems: string[] = [];
    const known = (side: string, title: string): boolean =>
        (side === 'server' ? scenarios.server : side === 'client' ? scenarios.client : [...scenarios.client, ...scenarios.server]).includes(title);

    for (const [id, row] of Object.entries(rows)) {
        const coverage = covered[id];
        const side = id.slice(0, id.indexOf('/'));

        if (coverage === undefined) {
            if (gaps[id] === undefined) {
                problems.push(`${id} has no scenario in the contract suite. Add one, or list it as a known gap with the reason.`);
            }

            continue;
        }

        if (gaps[id] !== undefined) {
            problems.push(`${id} has a scenario and is a known gap. Take it off the list of gaps.`);
        }

        const named: [string, string | undefined, boolean][] = [
            ['scenario', coverage.scenario, true],
            ['refusal', coverage.refusal, row.permission !== undefined],
            ['cleanup', coverage.cleanup, row.stops === true]
        ];

        for (const [what, title, needed] of named) {
            if (title === undefined && needed) {
                problems.push(`${id} names no ${what}: ${what === 'refusal' ? `it takes ${row.permission}` : 'it answers a function that stops it'}.`);
            } else if (title !== undefined && !known(side, title)) {
                problems.push(`${id} names a ${what} the contract suite does not hold: ${title}`);
            }
        }
    }

    for (const id of [...Object.keys(covered), ...Object.keys(gaps)]) {
        if (rows[id] === undefined) {
            problems.push(`${id} is no row of the inventory any more. Remove it.`);
        }
    }

    for (const [id, reason] of Object.entries(gaps)) {
        if (reason.trim() === '') {
            problems.push(`${id} is a known gap without a reason.`);
        }
    }

    return problems;
}

export async function readInventory(): Promise<InventoryRow[]> {
    const [client, server] = await Promise.all([readFile(join(EXTENSION, 'client.d.ts'), 'utf8'), readFile(join(EXTENSION, 'server.d.ts'), 'utf8')]);

    return [...rowsOf('client', client), ...rowsOf('server', server), ...manifestRows()];
}

/* What the contract suite says of the inventory as it is on disk. */
export async function checkInventory(rows: readonly InventoryRow[]): Promise<string[]> {
    const { EXTENSION_API_SCENARIOS, EXTENSION_API_KNOWN_GAPS } = (await import(join(CONTRACT, 'inventory.ts'))) as {
        EXTENSION_API_SCENARIOS: Record<string, Coverage>;
        EXTENSION_API_KNOWN_GAPS: Record<string, string>;
    };
    const [client, server] = await Promise.all([readFile(join(CONTRACT, 'client.ts'), 'utf8'), readFile(join(CONTRACT, 'server.ts'), 'utf8')]);

    return inventoryProblems(Object.fromEntries(rows.map((row) => [row.id, row])), EXTENSION_API_SCENARIOS, EXTENSION_API_KNOWN_GAPS, {
        client: scenariosOf(client),
        server: scenariosOf(server)
    });
}

if (import.meta.main) {
    const rows = await readInventory();
    const contents = render(rows);
    const check = process.argv.includes('--check');

    if (!check) {
        await writeFile(OUTPUT, contents);
    } else if ((await readFile(OUTPUT, 'utf8').catch(() => '')) !== contents) {
        throw new Error(`Stale generated file: ${relative(process.cwd(), OUTPUT)}. Run bun packages/contracts/scripts/generate-extension-inventory.ts`);
    }

    const problems = await checkInventory(rows);

    if (problems.length > 0) {
        throw new Error(`The inventory of the extension API and the contract suite disagree:\n${problems.join('\n')}`);
    }

    console.log(`${check ? 'Checked' : 'Generated'} the inventory of the extension API: ${rows.length} rows.`);
}
