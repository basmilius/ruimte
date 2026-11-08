import type { ACTION_DEFINITIONS, ActionActorKind, ActionInput, ActionName } from '../index.ts';

/* A value of a field, or of a member of a union, that only these actors may give. */
export interface RestrictedValue {
    value: unknown;
    actors: readonly ActionActorKind[];
}

export interface WriteCase<Name extends ActionName> {
    /* Who may run it, as the product rules decide; the catalog has to say the same. */
    actors: readonly ActionActorKind[];
    /* An input every actor of the action may give, already as the schema leaves it. */
    input: ActionInput<Name>;
    /* Inputs the schema refuses, by what is wrong with them. */
    refused: Record<string, unknown>;
    /* Every field or union member kept for some actors, by field name. */
    restricted?: Record<string, RestrictedValue>;
    /* Set when the catalog promises a confirmation before it runs. */
    confirms?: true;
}

export type WriteDomain = {
    [Name in ActionName]: (typeof ACTION_DEFINITIONS)[Name]['effect'] extends 'read' ? never : (typeof ACTION_DEFINITIONS)[Name]['domain'];
}[ActionName];

export type WriteCases = { [Name in ActionName]?: WriteCase<Name> };

/* The canvas a chat view names to operate a node on it, which only an agent gives. */
export const operatedView: Record<string, RestrictedValue> = { viewId: { value: 'main', actors: ['agent'] } };

export function without<Input extends object>(input: Input, field: keyof Input): Record<string, unknown> {
    const { [field]: _left, ...rest } = input as Record<PropertyKey, unknown>;
    return rest;
}
