import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { EVENT_SCHEMAS, PROTOCOL_VERSION, REQUEST_SCHEMAS } from '../src/index';
import { EventSchema, ReplySchema, RequestSchema } from '../src/envelope';
import { writeIfChanged } from './write-if-changed';

const output = resolve(process.env.RUIMTE_RUST_SCHEMA_OUTPUT ?? resolve(import.meta.dir, '../../../apps/server-rust/schema/contracts.json'));

const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(stable);
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => [key, stable(entry)])
    );
};

const preserveZodStringLengths = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(preserveZodStringLengths);
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    const object = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, preserveZodStringLengths(entry)]));
    if (typeof object.minLength === 'number') {
        object['x-zod-minLength'] = object.minLength;
        delete object.minLength;
    }
    if (typeof object.maxLength === 'number') {
        object['x-zod-maxLength'] = object.maxLength;
        delete object.maxLength;
    }
    return object;
};

const schema = (value: z.ZodType): unknown => preserveZodStringLengths(z.toJSONSchema(value, { io: 'input', reused: 'ref' }));

const generated = stable({
    protocol: PROTOCOL_VERSION,
    envelopes: {
        event: schema(EventSchema),
        reply: schema(ReplySchema),
        request: schema(RequestSchema)
    },
    events: Object.fromEntries(Object.entries(EVENT_SCHEMAS).map(([name, value]) => [name, schema(value)])),
    requests: Object.fromEntries(
        Object.entries(REQUEST_SCHEMAS).map(([name, value]) => [name, { payload: schema(value.payload), result: schema(value.result) }])
    )
});
const text = `${JSON.stringify(generated, null, 2)}\n`;

if (process.argv.includes('--check')) {
    const current = await readFile(output, 'utf8').catch(() => '');
    if (current !== text) {
        console.error('Rust contract schema is out of date. Run `bun run generate:rust`.');
        process.exit(1);
    }
} else {
    await writeIfChanged(output, text);
}
