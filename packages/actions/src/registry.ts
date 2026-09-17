import { z } from 'zod';
import { ACTION_DEFINITIONS, type ActionActorKind, type ActionInput, type ActionName, type ActionOutput } from './catalog.ts';

export interface ActionActor {
    kind: ActionActorKind;
    id: string;
}

export interface ActionCall<Context> {
    actor: ActionActor;
    context: Context;
}

export interface ActionConfirmation {
    title: string;
    consequences: string[];
}

export interface ActionCapability {
    name: ActionName;
    title: string;
    description: string;
    effect: 'read' | 'local' | 'shared' | 'external';
    input: Record<string, unknown>;
}

export type ActionCompleted<Name extends ActionName> = {
    status: 'completed';
    action: Name;
    output: ActionOutput<Name>;
    undoToken?: string;
};

export interface ActionFailed {
    status: 'failed';
    action: ActionName | null;
    error: {
        code: string;
        message: string;
        details?: unknown;
    };
}

export interface ActionNeedsConfirmation {
    status: 'needs_confirmation';
    action: ActionName;
    confirmationToken: string;
    confirmation: ActionConfirmation;
}

export type ActionResult<Name extends ActionName = ActionName> = ActionCompleted<Name> | ActionFailed | ActionNeedsConfirmation;

export type ActionControlResult = { status: 'completed'; action: ActionName } | ActionFailed;

export class ActionRefusal extends Error {
    readonly code: string;
    readonly details?: unknown;

    constructor(code: string, message: string, details?: unknown) {
        super(message);
        this.name = 'ActionRefusal';
        this.code = code;
        this.details = details;
    }
}

type MaybePromise<Value> = Value | Promise<Value>;

interface HandledAction<Name extends ActionName, Context> {
    output: ActionOutput<Name>;
    undo?: (call: ActionCall<Context>) => MaybePromise<void>;
}

interface ConfirmedAction {
    confirmation: ActionConfirmation;
}

export type ActionHandlerResult<Name extends ActionName, Context> = HandledAction<Name, Context> | ConfirmedAction;

export type ActionHandler<Context, Name extends ActionName> = (
    input: ActionInput<Name>,
    call: ActionCall<Context> & { confirmed: boolean }
) => MaybePromise<ActionHandlerResult<Name, Context>>;

export type ActionHandlers<Context> = {
    [Name in ActionName]?: ActionHandler<Context, Name>;
};

interface PendingAction {
    name: ActionName;
    input: unknown;
    actor: ActionActor;
}

interface UndoAction<Context> {
    name: ActionName;
    actor: ActionActor;
    run: (call: ActionCall<Context>) => MaybePromise<void>;
}

const TOKEN_LIMIT = 100;

const sameActor = (left: ActionActor, right: ActionActor): boolean => left.kind === right.kind && left.id === right.id;

const remember = <Value>(entries: Map<string, Value>, token: string, value: Value): void => {
    if (entries.size >= TOKEN_LIMIT) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) {
            entries.delete(oldest);
        }
    }
    entries.set(token, value);
};

const failure = (action: ActionName | null, code: string, message: string, details?: unknown): ActionFailed => ({
    status: 'failed',
    action,
    error: { code, message, ...(details === undefined ? {} : { details }) }
});

export class ActionRegistry<Context> {
    readonly #handlers: ActionHandlers<Context>;
    readonly #pending = new Map<string, PendingAction>();
    readonly #undo = new Map<string, UndoAction<Context>>();

    constructor(handlers: ActionHandlers<Context>) {
        this.#handlers = handlers;
    }

    catalog(call: ActionCall<Context>): ActionCapability[] {
        return (Object.keys(ACTION_DEFINITIONS) as ActionName[]).flatMap((name) => {
            const definition = ACTION_DEFINITIONS[name];
            if (!this.#handlers[name] || !definition.actors.includes(call.actor.kind)) {
                return [];
            }
            return [
                {
                    name,
                    title: definition.title,
                    description: definition.description,
                    effect: definition.effect,
                    input: z.toJSONSchema(definition.input) as Record<string, unknown>
                }
            ];
        });
    }

    execute<Name extends ActionName>(name: Name, input: unknown, call: ActionCall<Context>): Promise<ActionResult<Name>> {
        return this.#execute(name, input, call, false);
    }

    async confirm(token: string, approved: boolean, call: ActionCall<Context>): Promise<ActionResult> {
        const pending = this.#pending.get(token);
        if (!pending || !sameActor(pending.actor, call.actor)) {
            return failure(null, 'unknown-confirmation', 'This confirmation is no longer available.');
        }
        this.#pending.delete(token);
        if (!approved) {
            return failure(pending.name, 'confirmation-declined', 'The action was not performed.');
        }
        return this.#execute(pending.name, pending.input, call, true);
    }

    async undo(token: string, call: ActionCall<Context>): Promise<ActionControlResult> {
        const undo = this.#undo.get(token);
        if (!undo || !sameActor(undo.actor, call.actor)) {
            return failure(null, 'unknown-undo', 'This action can no longer be undone.');
        }
        this.#undo.delete(token);
        try {
            await undo.run(call);
            return { status: 'completed', action: undo.name };
        } catch (error) {
            return this.#failed(undo.name, error);
        }
    }

    async #execute<Name extends ActionName>(name: Name, input: unknown, call: ActionCall<Context>, confirmed: boolean): Promise<ActionResult<Name>> {
        const definition = ACTION_DEFINITIONS[name];
        const handler = this.#handlers[name] as ActionHandler<Context, Name> | undefined;
        if (!handler) {
            return failure(name, 'unsupported-action', `The action “${name}” is not available here.`);
        }
        if (!definition.actors.includes(call.actor.kind)) {
            return failure(name, 'forbidden-action', `The ${call.actor.kind} actor may not run “${name}”.`);
        }
        const parsed = definition.input.safeParse(input);
        if (!parsed.success) {
            return failure(name, 'invalid-input', z.prettifyError(parsed.error));
        }
        try {
            const handled = await handler(parsed.data as ActionInput<Name>, {
                ...call,
                confirmed
            });
            if ('confirmation' in handled) {
                if (confirmed) {
                    return failure(name, 'confirmation-loop', `The confirmed action “${name}” asked for confirmation again.`);
                }
                const confirmationToken = crypto.randomUUID();
                remember(this.#pending, confirmationToken, {
                    name,
                    input: parsed.data,
                    actor: call.actor
                });
                return {
                    status: 'needs_confirmation',
                    action: name,
                    confirmationToken,
                    confirmation: handled.confirmation
                };
            }
            const output = definition.output.safeParse(handled.output);
            if (!output.success) {
                return failure(name, 'invalid-output', `The “${name}” executor returned an invalid result.`, output.error.issues);
            }
            const undoToken = handled.undo ? crypto.randomUUID() : undefined;
            if (undoToken && handled.undo) {
                remember(this.#undo, undoToken, {
                    name,
                    actor: call.actor,
                    run: handled.undo
                });
            }
            return {
                status: 'completed',
                action: name,
                output: output.data as ActionOutput<Name>,
                ...(undoToken ? { undoToken } : {})
            };
        } catch (error) {
            return this.#failed(name, error);
        }
    }

    #failed(action: ActionName, error: unknown): ActionFailed {
        if (error instanceof ActionRefusal) {
            return failure(action, error.code, error.message, error.details);
        }
        return failure(action, 'action-failed', error instanceof Error ? error.message : `The action “${action}” failed.`);
    }
}
