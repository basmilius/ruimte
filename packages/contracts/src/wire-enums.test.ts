import { expect, test } from 'bun:test';
import { z } from 'zod';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS } from './index.ts';
import { CanvasNodeSchema } from './project.ts';

type JsonSchema = { [key: string]: unknown };

const OPEN_KIND = 'x-open-kind';

/* The values of every enum in what a client reads off a daemon, one line per vocabulary. */
function vocabularies(): string[] {
    const found = new Set<string>();
    const walk = (schema: unknown): void => {
        if (!schema || typeof schema !== 'object') {
            return;
        }
        const json = schema as JsonSchema;
        if (Array.isArray(json.enum)) {
            found.add(json.enum.map(String).sort().join(', '));
        }
        for (const [key, value] of Object.entries(json)) {
            if (key === 'properties' && json[OPEN_KIND] === true) {
                const { kind: _open, ...rest } = value as JsonSchema;
                walk(rest);
            } else if (Array.isArray(value)) {
                value.forEach(walk);
            } else {
                walk(value);
            }
        }
    };
    const read = (schema: z.ZodType): void =>
        walk(
            z.toJSONSchema(schema, {
                io: 'input',
                unrepresentable: 'any',
                override: ({ zodSchema, jsonSchema }) => {
                    // A node of a kind this version does not know reads as `unknown`, so that kind is open already.
                    if (zodSchema === CanvasNodeSchema) {
                        jsonSchema[OPEN_KIND] = true;
                    }
                }
            })
        );
    for (const pair of Object.values(REQUEST_SCHEMAS)) {
        read(pair.result);
    }
    for (const schema of Object.values(EVENT_SCHEMAS)) {
        read(schema);
    }
    return [...found].sort();
}

/*
 * A client validates a reply or an event whole, so one value it never saw refuses all of it: a
 * project list, a chat. A vocabulary that gains or loses a value is read open with a fallback
 * instead (`ProjectIconNameSchema`), or bumps PROTOCOL_VERSION. A new field with a vocabulary of its
 * own is fine: `bun test --update-snapshots` takes it in.
 */
test('no vocabulary a daemon sends gains or loses a value', () => {
    expect(vocabularies()).toMatchSnapshot();
});
