import { ACTION_DEFINITIONS, actionDescription, fieldDescription, type ActionInput, type ActionName, type ActionOutput } from '@ruimte/actions';
import type { z } from 'zod';
import { serverActionCall } from '../actions/context.ts';
import { serverActions } from '../actions/server-actions.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import { VerbRefusal, canvasLines, defineAction, placeOf, type Action, type VerbCall } from './verb.ts';

/* What the daemon's registry answers when a handler failed outright rather than refused. */
const FAILURES: ReadonlySet<string> = new Set(['action-failed', 'invalid-output']);

const linesOf = (details: unknown): string[] => (Array.isArray(details) && details.every((line) => typeof line === 'string') ? (details as string[]) : []);

/*
 * Runs an action for the agent behind this call and hands back its output, or throws what the CLI
 * prints: a refusal under the action's own code, or a plain error for a handler that broke.
 */
export const runAction = async <Name extends ActionName>(call: VerbCall, name: Name, input: ActionInput<Name>, dryRun = false): Promise<ActionOutput<Name>> => {
    const result = await serverActions.execute(name, input, serverActionCall(call.host, placeOf(call), call.caller, dryRun));
    if (result.status === 'completed') {
        return result.output;
    }
    if (result.status === 'needs_confirmation') {
        throw new VerbRefusal('confirmation-required', `${name} asks for a confirmation an agent cannot give`);
    }
    if (FAILURES.has(result.error.code)) {
        throw new Error(result.error.message);
    }
    throw new VerbRefusal(result.error.code, result.error.message, linesOf(result.error.details));
};

/*
 * The canvas a call means: the one `--view` names, else the one the caller is a node on. The action
 * checks that the id is a canvas; only a caller on no canvas at all is the CLI's to answer.
 */
export const canvasIdFor = async (
    call: VerbCall,
    place: IndexedPlace,
    view: string | undefined,
    offCanvas = 'This session is not on a canvas; name one with --view'
): Promise<string> => {
    if (view !== undefined) {
        return view;
    }
    if (place.canvasId !== null) {
        return place.canvasId;
    }
    throw new VerbRefusal('view-required', offCanvas, canvasLines(await call.host.read(place.projectId)));
};

/* One argument or flag of an action verb, as `help` prints it. */
export interface ActionParam<Name extends ActionName> {
    /* How the CLI writes it: `<viewId>` for an argument, `--view V` for a flag. */
    syntax: string;
    /* The column after it: required, optional, or the kinds it goes with. */
    need: string;
    /* The input field it fills; its description is the line. */
    field?: keyof ActionInput<Name> & string;
    /* The line where the catalog has no description for the field, or the flag fills none. */
    text?: string;
    /* What only the CLI adds after the description, such as a limit its parser holds or where an id comes from. */
    more?: string;
}

interface ActionVerbSpec<Name extends ActionName, Positionals extends z.ZodType, Flags extends z.ZodObject> {
    name: string;
    action: Name;
    usage: string;
    /* A sentence of the CLI's own after the description, such as the flags a kind cannot do without. */
    note?: string;
    params: readonly ActionParam<Name>[];
    /* Everything else `help` says: what it prints, the rules, where to look next. */
    detail: readonly string[];
    positionals: Positionals;
    flags: Flags;
    switches?: readonly string[];
    dryRun?: boolean;
    run(input: { positionals: z.infer<Positionals>; flags: z.infer<Flags>; switches: ReadonlySet<string>; dryRun: boolean }, call: VerbCall): Promise<string[]>;
}

const paramLine = <Name extends ActionName>(action: Name, param: ActionParam<Name>): string => {
    const shape = ACTION_DEFINITIONS[action].input.shape as Record<string, z.ZodType>;
    const described = param.field === undefined ? undefined : fieldDescription(shape[param.field]!);
    const text = [param.text ?? described, param.more].filter((part): part is string => part !== undefined).join('; ');
    if (text === '') {
        throw new Error(`${action} has no description for ${param.syntax}`);
    }
    return `${param.syntax.startsWith('-') ? 'flag' : 'argument'}\t${param.syntax}\t${param.need}\t${text}`;
};

/*
 * A noun's action that runs a catalog action: `help` reads what it does and what its fields mean
 * from the action definition, and this adds only how the CLI spells them and what it prints.
 */
export const defineActionVerb = <Name extends ActionName, Positionals extends z.ZodType, Flags extends z.ZodObject>(
    noun: string,
    spec: ActionVerbSpec<Name, Positionals, Flags>
): Action =>
    defineAction(noun, {
        ...spec,
        summary: [actionDescription(spec.action, 'agent'), spec.note].filter((part): part is string => part !== undefined).join(' '),
        detail: [...spec.params.map((param) => paramLine(spec.action, param)), ...spec.detail]
    });
