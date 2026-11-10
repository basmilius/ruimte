import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
    ACTION_ACTOR_KINDS,
    ACTION_DEFINITIONS,
    ACTION_NAMES,
    ActionRegistry,
    fieldActors,
    type ActionActor,
    type ActionActorKind,
    type ActionCall,
    type ActionDomain,
    type ActionHandler,
    type ActionHandlers,
    type ActionName
} from '../index.ts';
import type { WriteCase, WriteDomain } from './case.ts';
import { WRITE_CASES } from './cases.ts';
import { sampleOf } from './sample.ts';

interface Context {
    project: string;
}

interface HostCall {
    action: ActionName;
    input: unknown;
    actor: ActionActor;
    context: Context;
    confirmed: boolean;
}

const CONTEXT: Context = { project: 'Ruimte' };

function actor(kind: ActionActorKind): ActionActor {
    return { kind, id: `${kind}-1` };
}

function call(kind: ActionActorKind): ActionCall<Context> {
    return { actor: actor(kind), context: CONTEXT };
}

/* An executor for every action in the catalog, so a call that reaches the wrong one shows in what it noted. */
function fakeHost(): { handlers: ActionHandlers<Context>; calls: HostCall[] } {
    const calls: HostCall[] = [];
    const handlerFor = (action: ActionName): ActionHandler<Context, ActionName> => {
        return (input, { actor: caller, context, confirmed }) => {
            calls.push({ action, input, actor: caller, context, confirmed });
            return { output: sampleOf(ACTION_DEFINITIONS[action].output) };
        };
    };

    return { handlers: Object.fromEntries(ACTION_NAMES.map((name) => [name, handlerFor(name)])) as ActionHandlers<Context>, calls };
}

function isRestricted(schema: z.ZodType): boolean {
    if (fieldActors(schema) !== null) {
        return true;
    }
    return schema instanceof z.ZodUnion && (schema.options as z.ZodType[]).some((option) => fieldActors(option) !== null);
}

function writesOf(domain: ActionDomain): ActionName[] {
    return ACTION_NAMES.filter((name) => ACTION_DEFINITIONS[name].domain === domain && ACTION_DEFINITIONS[name].effect !== 'read');
}

function describeWrite<Name extends ActionName>(name: Name, writeCase: WriteCase<Name>): void {
    const definition = ACTION_DEFINITIONS[name];
    const others = ACTION_ACTOR_KINDS.filter((kind) => !writeCase.actors.includes(kind));

    describe(name, () => {
        test(`is run by ${writeCase.actors.join(', ')} through its own executor, with the input as given`, async () => {
            expect([...definition.actors].sort()).toEqual([...writeCase.actors].sort());
            for (const kind of writeCase.actors) {
                const host = fakeHost();
                const registry = new ActionRegistry<Context>(host.handlers);
                const result: unknown = await registry.execute(name, writeCase.input, call(kind));
                expect(result).toEqual({ status: 'completed', action: name, output: sampleOf(definition.output as z.ZodType) });
                expect(host.calls).toEqual([{ action: name, input: writeCase.input, actor: actor(kind), context: CONTEXT, confirmed: false }]);
            }
        });

        if (others.length > 0) {
            test(`refuses ${others.join(', ')} with forbidden-action`, async () => {
                for (const kind of others) {
                    const host = fakeHost();
                    const registry = new ActionRegistry<Context>(host.handlers);
                    expect(await registry.execute(name, writeCase.input, call(kind))).toMatchObject({
                        status: 'failed',
                        action: name,
                        error: { code: 'forbidden-action' }
                    });
                    expect(host.calls).toEqual([]);
                }
            });
        }

        test('refuses an input its schema does not take', async () => {
            const refused = Object.entries(writeCase.refused);
            expect(refused.length).toBeGreaterThan(0);
            for (const [why, input] of refused) {
                const host = fakeHost();
                const registry = new ActionRegistry<Context>(host.handlers);
                const result = await registry.execute(name, input, call(writeCase.actors[0]!));
                expect({ why, result }).toMatchObject({ why, result: { status: 'failed', error: { code: 'invalid-input' } } });
                expect(host.calls).toEqual([]);
            }
        });

        if (Object.keys(writeCase.restricted ?? {}).length > 0) {
            test('takes a field kept for some actors only from them', async () => {
                const restricted = writeCase.restricted ?? {};
                for (const [field, { value, actors }] of Object.entries(restricted)) {
                    for (const kind of writeCase.actors) {
                        const host = fakeHost();
                        const registry = new ActionRegistry<Context>(host.handlers);
                        const input = { ...writeCase.input, [field]: value };
                        const result = await registry.execute(name, input, call(kind));
                        if (actors.includes(kind)) {
                            expect({ field, kind, result }).toMatchObject({ field, kind, result: { status: 'completed' } });
                            expect(host.calls.map((noted) => noted.input)).toEqual([input]);
                        } else {
                            expect({ field, kind, result }).toMatchObject({ field, kind, result: { status: 'failed', error: { code: 'forbidden-field' } } });
                            expect(host.calls).toEqual([]);
                        }
                    }
                }
            });
        }
    });
}

/* The tests of every action of a domain that changes something, which have to be all of them. */
export function describeWrites(domain: WriteDomain): void {
    const cases = WRITE_CASES[domain];
    describe(`the ${domain} actions that change something`, () => {
        test('each have their case', () => {
            expect(Object.keys(cases).sort()).toEqual(writesOf(domain).sort());
            for (const name of writesOf(domain)) {
                const shape = ACTION_DEFINITIONS[name].input.shape as Record<string, z.ZodType>;
                const fields = Object.keys(shape).filter((field) => isRestricted(shape[field]!));
                expect({ action: name, fields: Object.keys(cases[name]?.restricted ?? {}).sort() }).toEqual({ action: name, fields: fields.sort() });
            }
        });

        for (const name of Object.keys(cases) as ActionName[]) {
            describeWrite(name, cases[name] as WriteCase<typeof name>);
        }
    });
}
