import { ToolRefusal } from '@adecore/agents/context';
import { type ActionInput, type ActionName, type ActionOutput } from '@ruimte/actions';
import { z } from 'zod';
import { serverActionCall } from '../actions/context.ts';
import { PROJECT_WRITES } from '../actions/revision.ts';
import { serverActions } from '../actions/server-actions.ts';
import { canvasLines, placeOf, type AgentCall } from '../canvas/host.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import { defineTool, REVISION_INPUT, type Tool, type ToolSpec } from './tool.ts';

/* What the daemon's registry answers when a handler failed outright rather than refused. */
const FAILURES: ReadonlySet<string> = new Set(['action-failed', 'invalid-output']);

export function jsonLines(value: unknown): string[] {
    return [JSON.stringify(value, null, 2)];
}

export function linesOf(details: unknown): string[] {
    return Array.isArray(details) && details.every((line) => typeof line === 'string') ? (details as string[]) : [];
}

/*
 * Runs an action for the agent behind this call and hands back its output, or throws a refusal under
 * the action's own code, or a plain error for a handler that broke.
 */
export async function runAction<Name extends ActionName>(call: AgentCall, name: Name, input: ActionInput<Name>, dryRun = false): Promise<ActionOutput<Name>> {
    const origin = call.reached === undefined ? undefined : placeOf({ caller: call.caller, host: call.host });
    const result = await serverActions.execute(name, input, serverActionCall(call.host, placeOf(call), call.caller, dryRun, call.expectedRevision, origin));

    if (result.status === 'needs_confirmation') {
        throw new ToolRefusal('confirmation-required', `${name} asks for a confirmation an agent cannot give`);
    }

    if (result.status === 'failed') {
        if (FAILURES.has(result.error.code)) {
            throw new Error(result.error.message);
        }

        throw new ToolRefusal(result.error.code, result.error.message, linesOf(result.error.details));
    }

    // An action that goes on after its answer has already made what the tool prints.
    return result.output;
}

/*
 * The canvas a call means: the one `view` names, else the one the caller is a node on. The action
 * checks that the id is a canvas; only a caller on no canvas at all is the tool's to answer.
 */
export async function canvasIdFor(
    call: AgentCall,
    place: IndexedPlace,
    view: string | undefined,
    offCanvas = 'This session is not on a canvas; name one with view'
): Promise<string> {
    if (view !== undefined) {
        return view;
    }

    if (place.canvasId !== null) {
        return place.canvasId;
    }

    throw new ToolRefusal('view-required', offCanvas, canvasLines(await call.host.projects.read(place.projectId)));
}

/* The canvas of a node a person pointed the caller at with `#`, which then needs no view: the reference says where it stands. */
export function pointedCanvas(call: AgentCall, ids: readonly string[], kind?: string): string | null {
    const references = call.host.context?.referenced?.(call.caller) ?? [];

    return references.find((reference) => ids.includes(reference.id) && (kind === undefined || reference.kind === kind))?.canvas?.id ?? null;
}

export interface ActionToolSpec<Input extends z.ZodObject> extends ToolSpec<Input> {
    /* The action of `@ruimte/actions` the tool runs, whose handler holds every check. */
    action: ActionName;
}

/* `revision` is added to a tool whose action writes the project file, so no write goes without it. */
export interface ActionTool<Input extends z.ZodObject = z.ZodObject> extends Tool<Input> {
    readonly action: ActionName;
}

/*
 * A tool that runs an action of `@ruimte/actions`, so a person, Voice and an agent meet the same
 * checks. The tool only says how its fields fill the action's input and what it prints.
 */
export function defineActionTool<Input extends z.ZodObject>(toolkit: string, spec: ActionToolSpec<Input>): ActionTool<Input> {
    const input = PROJECT_WRITES.has(spec.action) ? (spec.input.extend({ revision: REVISION_INPUT }) as unknown as Input) : spec.input;

    return { ...defineTool(toolkit, { ...spec, input }), action: spec.action };
}
