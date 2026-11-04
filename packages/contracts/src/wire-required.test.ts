import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { z } from 'zod';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS } from './index.ts';

/*
 * The wire only gains optional fields: a key one side starts to require is one the other side's older
 * release never sends. This holds the required keys of every object in every payload, reply and event
 * against a fixture, so a new required key fails here. A key that turns optional, or a new message, is
 * free, but the fixture has to know it, so the next change to it is held as well.
 * `RUIMTE_WRITE_WIRE_FIXTURE=1 bun test packages/contracts/src/wire-required.test.ts` writes the fixture anew.
 */

const FIXTURE_PATH = join(import.meta.dir, 'wire-required.fixture.json');

type JsonSchema = { [key: string]: unknown };
type RequiredKeys = Record<string, string[]>;

function escaped(key: string): string {
    return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

/* Per message and object path, the keys a parse of that object demands. */
function requiredKeys(schemas: Record<string, z.ZodType>): RequiredKeys {
    const found: RequiredKeys = {};

    for (const [name, schema] of Object.entries(schemas)) {
        const root = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;

        const resolve = (reference: string): unknown => {
            if (reference === '#') {
                return root;
            }

            if (!reference.startsWith('#/')) {
                throw new Error(`Unsupported schema reference: ${reference}`);
            }

            return reference
                .slice(2)
                .split('/')
                .reduce<unknown>((node, key) => (node as JsonSchema)?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], root);
        };

        const walk = (value: unknown, path: string, ancestors: Set<object>): void => {
            if (!value || typeof value !== 'object' || ancestors.has(value)) {
                return;
            }

            const parents = new Set(ancestors).add(value);
            const json = value as JsonSchema;

            if (typeof json.$ref === 'string') {
                walk(resolve(json.$ref), path, parents);
            }

            if (json.type === 'object' && json.properties !== undefined) {
                found[`${name} ${path}`] = Array.isArray(json.required) ? [...(json.required as string[])].sort() : [];
            }

            for (const [key, child] of Object.entries(json)) {
                if (key === '$defs' || key === 'definitions' || key === '$ref') {
                    continue;
                }

                if (key === 'properties') {
                    for (const [field, schema] of Object.entries(child as JsonSchema)) {
                        walk(schema, `${path}/properties/${escaped(field)}`, parents);
                    }
                } else {
                    walk(child, `${path}/${escaped(key)}`, parents);
                }
            }
        };

        walk(root, '#', new Set());
    }

    return Object.fromEntries(Object.entries(found).sort(([left], [right]) => left.localeCompare(right)));
}

/* What the fixture would have to give up to take the current wire: every key newly required. */
function newlyRequired(fixture: RequiredKeys, current: RequiredKeys): string[] {
    return Object.entries(current).flatMap(([path, keys]) => {
        const known = fixture[path];

        return known === undefined ? [] : keys.filter((key) => !known.includes(key)).map((key) => `${path} requires ${key}`);
    });
}

function wire(): Record<string, z.ZodType> {
    return Object.fromEntries([
        ...Object.entries(REQUEST_SCHEMAS).flatMap(([name, pair]) => [[`payload ${name}`, pair.payload] as const, [`reply ${name}`, pair.result] as const]),
        ...Object.entries(EVENT_SCHEMAS).map(([name, schema]) => [`event ${name}`, schema] as const)
    ]);
}

test('no payload, reply or event requires a key the fixture did not', async () => {
    const current = requiredKeys(wire());

    if (process.env.RUIMTE_WRITE_WIRE_FIXTURE === '1') {
        // One line per object, so a review of a new fixture reads as a list of objects.
        const lines = Object.entries(current).map(([path, keys]) => `    ${JSON.stringify(path)}: ${JSON.stringify(keys)}`);
        await Bun.write(FIXTURE_PATH, `{\n${lines.join(',\n')}\n}\n`);
    }

    const fixture = (await Bun.file(FIXTURE_PATH).json()) as RequiredKeys;

    expect(newlyRequired(fixture, current)).toEqual([]);
    // A new message or object is not yet held; write the fixture anew once it is meant.
    expect(Object.keys(current).filter((path) => fixture[path] === undefined)).toEqual([]);
});

test('a new required key fails, a key that turns optional and a new message pass', () => {
    const before = requiredKeys({
        'payload a.b': z.object({ id: z.string(), note: z.string().optional(), inner: z.object({ x: z.number() }).optional() })
    });
    const added = requiredKeys({
        'payload a.b': z.object({ id: z.string(), note: z.string(), inner: z.object({ x: z.number(), y: z.number() }).optional() })
    });
    const loosened = requiredKeys({
        'payload a.b': z.object({ id: z.string().optional(), note: z.string().optional(), inner: z.object({ x: z.number() }).optional() }),
        'payload a.c': z.object({ id: z.string() })
    });
    expect(newlyRequired(before, added)).toEqual(['payload a.b # requires note', 'payload a.b #/properties/inner requires y']);
    expect(newlyRequired(before, loosened)).toEqual([]);
});

test('a key with a default is not required of the sender', () => {
    expect(requiredKeys({ message: z.object({ id: z.string(), limit: z.number().default(10) }) })).toEqual({ 'message #': ['id'] });
});
