import { expect, test } from 'bun:test';
import { z } from 'zod';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS } from './index.ts';
import { CanvasNodeSchema } from './project.ts';

type JsonSchema = { [key: string]: unknown };

const OPEN_KIND = 'x-open-kind';

function vocabularies(schemas: Record<string, z.ZodType>): string[] {
    const found: string[] = [];
    for (const [name, schema] of Object.entries(schemas)) {
        const root = z.toJSONSchema(schema, {
            io: 'input',
            unrepresentable: 'any',
            override: ({ zodSchema, jsonSchema }) => {
                // Unknown canvas kinds round-trip, so this discriminator is already open.
                if (zodSchema === CanvasNodeSchema) {
                    jsonSchema[OPEN_KIND] = true;
                }
            }
        });
        const walk = (value: unknown, path: string, ancestors: Set<object>): void => {
            if (!value || typeof value !== 'object' || ancestors.has(value)) {
                return;
            }
            const parents = new Set(ancestors).add(value);
            const json = value as JsonSchema;
            if (typeof json.$ref === 'string') {
                if (json.$ref !== '#' && !json.$ref.startsWith('#/')) {
                    throw new Error(`Unsupported schema reference: ${json.$ref}`);
                }
                const target =
                    json.$ref === '#'
                        ? root
                        : json.$ref
                              .slice(2)
                              .split('/')
                              .reduce<unknown>((node, key) => {
                                  return (node as JsonSchema)?.[key.replaceAll('~1', '/').replaceAll('~0', '~')];
                              }, root);
                if (!target) {
                    throw new Error(`Unresolved schema reference: ${json.$ref}`);
                }
                walk(target, path, parents);
            }
            if (Array.isArray(json.enum)) {
                found.push(
                    `${name} ${path} = [${json.enum
                        .map((item) => JSON.stringify(item))
                        .sort()
                        .join(', ')}]`
                );
            }
            for (const [key, child] of Object.entries(json)) {
                if (key === '$defs' || key === 'definitions' || key === '$ref') {
                    continue;
                }
                const next = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
                if (key === 'properties') {
                    for (const [field, schema] of Object.entries(child as JsonSchema)) {
                        if (field === 'kind' && json[OPEN_KIND] === true) {
                            continue;
                        }
                        walk(schema, `${next}/${field.replaceAll('~', '~0').replaceAll('/', '~1')}`, parents);
                    }
                } else {
                    walk(child, next, parents);
                }
            }
        };
        walk(root, '#', new Set());
    }
    return found.sort();
}

// Review changed fields for old-client compatibility before accepting a new snapshot.
test('every reply and event field keeps its vocabulary', () => {
    const schemas = Object.fromEntries([
        ...Object.entries(REQUEST_SCHEMAS).map(([name, pair]) => [`reply ${name}`, pair.result] as const),
        ...Object.entries(EVENT_SCHEMAS).map(([name, schema]) => [`event ${name}`, schema] as const)
    ]);
    expect(vocabularies(schemas)).toMatchSnapshot();
});

test('reusing an existing vocabulary on another field or message is a visible change', () => {
    const small = z.enum(['open', 'done']);
    const large = z.enum(['open', 'done', 'failed']);
    const message = (state: z.ZodType) => z.object({ state, small, large });
    const original = { first: message(small), second: message(large) };
    expect(vocabularies({ ...original, first: message(large) })).not.toEqual(vocabularies(original));
    expect(vocabularies({ first: original.second, second: original.first })).not.toEqual(vocabularies(original));
});

test('recursive schemas retain the vocabularies of each referencing field', () => {
    function tree(states: ['open', 'done'] | ['open', 'done', 'failed']) {
        const node = z.object({
            state: z.enum(states),
            get children() {
                return z.array(node);
            }
        });
        return node;
    }
    const shared = tree(['open', 'done']);
    const before = z.object({ left: shared, right: shared });
    const after = z.object({ left: shared, right: tree(['open', 'done', 'failed']) });
    const fields = vocabularies({ message: before });
    expect(fields.some((field) => field.includes('/properties/left/properties/state'))).toBe(true);
    expect(fields.some((field) => field.includes('/properties/right/properties/state'))).toBe(true);
    expect(vocabularies({ message: after })).not.toEqual(fields);
});

test('schema metadata names do not hide message fields', () => {
    const schema = z.object({ $defs: z.enum(['open', 'done']), $ref: z.enum(['yes', 'no']) });
    expect(vocabularies({ message: schema })).toEqual(['message #/properties/$defs = ["done", "open"]', 'message #/properties/$ref = ["no", "yes"]']);
});
