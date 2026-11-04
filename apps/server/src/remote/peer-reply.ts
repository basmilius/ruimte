import { CodedError } from '@adecore/agents';
import { REQUEST_SCHEMAS } from '@ruimte/contracts';
import { z } from 'zod';
import { isRecord } from '../is-record.ts';

interface ResultSchemas {
    [type: string]: { result: z.ZodType } | undefined;
}

// The parts of a schema's definition that decide which keys it names.
interface Def {
    type: string;
    shape?: Record<string, z.core.$ZodType>;
    catchall?: z.core.$ZodType;
    element?: z.core.$ZodType;
    innerType?: z.core.$ZodType;
    options?: z.core.$ZodType[];
    valueType?: z.core.$ZodType;
    items?: z.core.$ZodType[];
    getter?: () => z.core.$ZodType;
}

/*
 * The value with every key left out that no object in the schema names. A parse keeps the keys of a loose
 * object, and a schema this package does not own may turn loose, so this does not rely on the parse to drop them.
 */
function named(schema: z.core.$ZodType, value: unknown): unknown {
    const def = schema._zod.def as unknown as Def;
    switch (def.type) {
        case 'object': {
            if (!isRecord(value) || def.shape === undefined) {
                return value;
            }
            // A catchall that is a schema of its own names the other keys; the loose one (`unknown`) and the strict one do not.
            const extra =
                def.catchall !== undefined && !['unknown', 'never', 'any'].includes((def.catchall._zod.def as unknown as Def).type) ? def.catchall : null;
            return Object.fromEntries(
                Object.entries(value).flatMap(([key, entry]) => {
                    const known = def.shape![key] ?? extra;
                    return known === undefined || known === null ? [] : [[key, named(known, entry)]];
                })
            );
        }
        case 'array':
            return Array.isArray(value) && def.element !== undefined ? value.map((entry) => named(def.element!, entry)) : value;
        case 'tuple':
            return Array.isArray(value) && def.items !== undefined
                ? value.map((entry, i) => (def.items![i] === undefined ? entry : named(def.items![i]!, entry)))
                : value;
        case 'record':
            return isRecord(value) && def.valueType !== undefined
                ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, named(def.valueType!, entry)]))
                : value;
        case 'nullable':
        case 'optional':
        case 'default':
        case 'prefault':
        case 'readonly':
        case 'nonoptional':
            return value === null || value === undefined || def.innerType === undefined ? value : named(def.innerType, value);
        case 'union': {
            const option = def.options?.find((candidate) => z.safeParse(candidate, value).success);
            return option === undefined ? value : named(option, value);
        }
        case 'lazy':
            return def.getter === undefined ? value : named(def.getter(), value);
        default:
            return value;
    }
}

/*
 * What another machine answered, read with the schema of the request. That machine is not trusted: an
 * answer that does not fit is an error here, and what does fit loses every key the schema does not name.
 */
export function checkedReply<T>(type: string, reply: unknown, schemas: ResultSchemas = REQUEST_SCHEMAS as unknown as ResultSchemas): T {
    const schema = schemas[type];
    if (schema === undefined) {
        throw new CodedError('bad-reply', `The other machine was asked for ${type}, which this machine does not know`);
    }
    const parsed = schema.result.safeParse(reply);
    if (!parsed.success) {
        throw new CodedError('bad-reply', `The other machine answered ${type} with something that is not an answer to it`);
    }
    return named(schema.result, parsed.data) as T;
}
