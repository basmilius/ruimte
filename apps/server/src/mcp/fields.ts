import { escapeText } from '@ruimte/actions/text-escapes';
import { z } from 'zod';
import { DRY_RUN_FLAG, REVISION_FLAG, specOf, VerbRefusal, type Action, type Verb } from '../canvas/verb.ts';

/* One property of a tool's input schema, as compact as a model reads it: no bounds, no unions, no nulls. A type, so the SDK's JSON values take it. */
export type JsonField = {
    type: 'string' | 'integer' | 'number' | 'boolean' | 'array';
    description?: string;
    enum?: string[];
    items?: { type: 'string' };
};

/*
 * One field of a tool and the words it becomes: a positional in its place, the rest of the positionals
 * for a variadic one, `--flag=value`, a switch that is on when true, or `state`, a switch that may also
 * take a value (`--state` or `--state=full`), for which `on` is the bare switch.
 */
export interface ToolField {
    key: string;
    kind: 'positional' | 'variadic' | 'flag' | 'switch' | 'state';
    flag: string;
    required: boolean;
    schema: JsonField;
}

/* The bare switch of a `state` field. */
export const SWITCH_ON = 'on';

export const DRY_RUN_KEY = 'dry_run';

const MAX_FIELD_TEXT = 90;

interface DetailRow {
    name: string;
    need: string;
    text: string;
}

/* `nodeId` and `request-id` as a tool field: `node_id` and `request_id`. */
export function fieldKey(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replaceAll('-', '_')
        .toLowerCase();
}

/* A help or refusal text with every `--flag` it names written as the tool field that carries it. */
export function withFieldNames(text: string): string {
    return text.replace(/(^|[^\w-])--([a-z][\w-]*)/g, (_whole, before: string, name: string) => `${before}${fieldKey(name)}`);
}

/* The first clause of a help text, cut at a word near the cap, so a field says what it is and nothing more. */
export function shortText(text: string, cap = MAX_FIELD_TEXT): string {
    const clause = withFieldNames(text.split('; ')[0]!.trim());

    if (clause.length <= cap) {
        return clause;
    }

    const cut = clause.slice(0, cap);
    const comma = cut.lastIndexOf(', ');
    const colon = cut.lastIndexOf(': ');
    const at = Math.max(comma, colon);

    return at > cap / 2 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf(' '));
}

function detailRows(detail: readonly string[], kind: 'argument' | 'flag'): DetailRow[] {
    return detail
        .filter((line) => line.startsWith(`${kind}\t`))
        .map((line) => line.split('\t'))
        .map(([, syntax = '', need = '', text = '']) => ({
            name: kind === 'flag' ? syntax.replace(/^--/, '').split(/[ =]/)[0]! : (/^<([^>|]+)/.exec(syntax)?.[1] ?? syntax),
            need,
            text
        }));
}

function variadicRow(row: DetailRow | undefined, syntax: string): boolean {
    return row !== undefined && (syntax.includes('...') || row.need === 'one or more');
}

/* The plain type and the choices of a schema, as JSON Schema writes its input; a number a flag spells as digits is a number. */
function jsonType(schema: z.ZodType): Pick<JsonField, 'type' | 'enum'> {
    let json: Record<string, unknown>;

    try {
        json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    } catch {
        return { type: 'string' };
    }

    const choices = Array.isArray(json.enum) ? json.enum.filter((choice): choice is string => typeof choice === 'string') : [];
    const enumOf = choices.length > 0 ? { enum: choices } : {};

    if (json.type === 'integer' || json.type === 'number' || json.type === 'boolean') {
        return { type: json.type };
    }

    if (json.pattern === '^\\d+$') {
        return { type: 'integer' };
    }

    if (json.pattern === '^\\d+(\\.\\d+)?$') {
        return { type: 'number' };
    }

    return { type: 'string', ...enumOf };
}

function described(field: Omit<JsonField, 'description'>, text: string | undefined): JsonField {
    return text === undefined || text === '' ? field : { ...field, description: shortText(text) };
}

function optional(schema: z.ZodType | undefined): boolean {
    return schema === undefined || schema.safeParse(undefined).success;
}

function positionalFields(entry: Verb | Action, positionals: z.ZodType): ToolField[] {
    const rows = detailRows(entry.detail, 'argument');
    const syntaxes = entry.detail.filter((line) => line.startsWith('argument\t')).map((line) => line.split('\t')[1] ?? '');
    const tuple = positionals instanceof z.ZodTuple ? (positionals.def.items as z.ZodType[]) : null;
    const rest = positionals instanceof z.ZodTuple ? (positionals.def.rest as z.ZodType | null) : null;
    const count = tuple === null ? rows.length : tuple.length + (rest === null ? 0 : 1);

    return Array.from({ length: count }, (_unused, index) => {
        const row = rows[index];
        const variadic = (tuple !== null && index === tuple.length) || variadicRow(row, syntaxes[index] ?? '');
        const item = tuple?.[index];
        const name = row?.name ?? `argument${index + 1}`;
        const required = row?.need === 'required' || row?.need === 'one or more' ? (item === undefined ? true : !optional(item)) : false;

        if (variadic) {
            return {
                key: fieldKey(name),
                kind: 'variadic',
                flag: name,
                required,
                schema: described({ type: 'array', items: { type: 'string' } }, row?.text)
            };
        }

        return {
            key: fieldKey(name),
            kind: 'positional',
            flag: name,
            required,
            schema: described(item === undefined ? { type: 'string' } : jsonType(item), row?.text)
        };
    });
}

/*
 * The fields of a verb or an action, read off the spec it was defined from and the rows its help
 * prints, so a tool takes exactly what the verb parses. `hidden` names flags a tool fills itself.
 */
export function fieldsOf(entry: Verb | Action, hidden: ReadonlySet<string> = new Set()): ToolField[] {
    const spec = specOf(entry);

    if (spec === undefined) {
        throw new Error(`${entry.name} was not made through defineVerb or defineAction, so its fields are unknown`);
    }

    const rows = new Map(detailRows(entry.detail, 'flag').map((row) => [row.name, row]));
    const switches = new Set([...(spec.switches ?? []), ...(spec.dryRun === true ? [DRY_RUN_FLAG] : [])]);
    const shape = spec.flags.shape as Record<string, z.ZodType>;
    const fields = positionalFields(entry, spec.positionals);

    for (const [flag, schema] of Object.entries(shape)) {
        if (hidden.has(flag)) {
            continue;
        }

        const text = rows.get(flag)?.text;

        if (switches.has(flag)) {
            const type = jsonType(schema);
            fields.push({
                key: fieldKey(flag),
                kind: 'state',
                flag,
                required: false,
                schema: described({ type: 'string', enum: [SWITCH_ON, ...(type.enum ?? [])] }, text)
            });

            continue;
        }

        fields.push({ key: fieldKey(flag), kind: 'flag', flag, required: !optional(schema), schema: described(jsonType(schema), text) });
    }

    if (spec.revision === true) {
        // Said once in the server's instructions rather than on every tool that writes the project.
        fields.push({ key: REVISION_FLAG, kind: 'flag', flag: REVISION_FLAG, required: false, schema: { type: 'integer' } });
    }

    for (const flag of switches) {
        if (hidden.has(flag) || flag in shape) {
            continue;
        }

        fields.push({ key: fieldKey(flag), kind: 'switch', flag, required: false, schema: described({ type: 'boolean' }, rows.get(flag)?.text) });
    }

    const keys = new Set<string>();

    for (const field of fields) {
        if (keys.has(field.key)) {
            throw new Error(`${entry.name} has two fields named ${field.key}`);
        }

        keys.add(field.key);
    }

    return fields;
}

function word(value: unknown): string {
    if (Array.isArray(value)) {
        return value.map(word).join(',');
    }

    if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value);
    }

    return String(value);
}

/*
 * The words a verb parses for a tool's input: the positionals in order, then every flag as
 * `--flag=value`, so a value that starts with `--` stays a value. `escaped` names the flags whose
 * value the verb reads escapes in, which are doubled here so the text arrives as it was sent.
 */
export function argvOf(fields: readonly ToolField[], input: Readonly<Record<string, unknown>>, escaped: ReadonlySet<string> = new Set()): string[] {
    const positionals: string[] = [];
    const flags: string[] = [];
    let open = true;

    for (const field of fields) {
        const value = input[field.key];
        const given = value !== undefined && value !== null;

        if (field.kind === 'positional' || field.kind === 'variadic') {
            open &&= given;

            if (open) {
                positionals.push(...(field.kind === 'variadic' && Array.isArray(value) ? value.map(word) : [word(value)]));
            }

            continue;
        }

        if (!given) {
            continue;
        }

        if (field.kind === 'switch') {
            if (value === true || value === 'true') {
                flags.push(`--${field.flag}`);
            }

            continue;
        }

        if (field.kind === 'state' && (value === SWITCH_ON || value === true)) {
            flags.push(`--${field.flag}`);

            continue;
        }

        const text = word(value);
        flags.push(`--${field.flag}=${escaped.has(field.flag) ? escapeText(text) : text}`);
    }

    return [...positionals, ...flags];
}

/* Refuses input keys the tool has no field for, which a verb would otherwise never see. */
export function checkKeys(
    tool: string,
    fields: readonly Pick<ToolField, 'key'>[],
    input: Readonly<Record<string, unknown>>,
    extra: readonly string[] = []
): void {
    const known = new Set([...fields.map((field) => field.key), ...extra]);
    const unknown = Object.keys(input).filter((key) => !known.has(key));

    if (unknown.length > 0) {
        throw new VerbRefusal('bad-arguments', `${tool} takes no ${unknown.join(', ')}`, [`fields\t${[...known].join('\t')}`]);
    }
}
