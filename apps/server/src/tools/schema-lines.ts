import { z } from 'zod';

/* What a field takes, read off its schema, so a shape or a tone added in contracts shows up in a guide without an edit. */
export function typeOf(schema: z.ZodType): string {
    if (schema instanceof z.ZodOptional) {
        return typeOf(schema.unwrap() as z.ZodType);
    }

    if (schema instanceof z.ZodLiteral) {
        return schema.values.size === 1 ? JSON.stringify([...schema.values][0]) : 'value';
    }

    if (schema instanceof z.ZodObject) {
        return 'object';
    }

    if (schema instanceof z.ZodEnum) {
        return schema.options.join('|');
    }

    if (schema instanceof z.ZodArray) {
        return `${typeOf(schema.element as z.ZodType)}[]`;
    }

    if (schema instanceof z.ZodTuple) {
        return `[${(schema.def.items as z.ZodType[]).map(typeOf).join(', ')}]`;
    }

    if (schema instanceof z.ZodString) {
        return 'string';
    }

    if (schema instanceof z.ZodNumber) {
        return 'number';
    }

    return 'value';
}

/* One `field` line per key of a document's schema, with the sentence `about` gives it. */
export function fieldLines(prefix: string, shape: Record<string, z.ZodType>, about: Record<string, string>): string[] {
    return Object.entries(shape).map(
        ([key, schema]) => `field\t${prefix}${key}\t${schema instanceof z.ZodOptional ? 'optional' : 'required'}\t${typeOf(schema)}\t${about[key]}`
    );
}
