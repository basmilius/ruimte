import { ActionRefusal, type ActionCall, type ActionInput, type ActionName, type ActionOutput, type ActionRegistry } from '@ruimte/actions';

export const PERSON_ACTION_CALL: ActionCall<void> = {
    actor: { kind: 'person', id: 'local-person' },
    context: undefined
};

export interface PerformOptions {
    /* The person already answered the app's own dialog before this runs, so the action's question is theirs to answer. */
    confirmed?: boolean;
}

let registry: ActionRegistry<void> | null = null;

/* Handed over by `actions/client-actions.ts`, which builds the registry out of every feature. */
export function provideClientActions(clientActions: ActionRegistry<void>): void {
    registry = clientActions;
}

/*
 * Runs an action as the person at this window. Throws the refusal with the machine's own code, so a
 * surface that says how it went can tell a diverged branch from a failure.
 */
export async function perform<Name extends ActionName>(name: Name, input: ActionInput<Name>, options: PerformOptions = {}): Promise<ActionOutput<Name>> {
    return performIn(clientRegistry(), name, input, options);
}

export function clientRegistry(): ActionRegistry<void> {
    if (registry === null) {
        throw new Error('No action registry is provided yet.');
    }
    return registry;
}

export async function performIn<Name extends ActionName>(
    actions: ActionRegistry<void>,
    name: Name,
    input: ActionInput<Name>,
    { confirmed = false }: PerformOptions = {}
): Promise<ActionOutput<Name>> {
    const asked = await actions.execute(name, input, PERSON_ACTION_CALL);
    if (asked.status === 'needs_confirmation' && !confirmed) {
        throw new ActionRefusal('confirmation-required', `“${name}” asked a person for a confirmation their own dialog should have given.`);
    }
    const result = asked.status === 'needs_confirmation' ? await actions.confirm(asked.confirmationToken, true, PERSON_ACTION_CALL) : asked;
    if (result.status === 'failed') {
        throw new ActionRefusal(result.error.code, result.error.message, result.error.details);
    }
    if (result.status === 'needs_confirmation') {
        throw new ActionRefusal('confirmation-loop', `“${name}” asked a second time.`);
    }
    return result.output as ActionOutput<Name>;
}

/* A person sees what happened on screen, so a surface that says nothing itself catches a refusal with this. */
export function ignoreRefusal(): null {
    return null;
}

export type CreatableViewKind = ActionInput<'view.create'>['kind'];
export type CreatableNodeKind = ActionInput<'node.create'>['kind'];

/* The id prefix of an operation a git run streams its progress under. */
export const GIT_OPERATION = 'git:';

export const VOICE_ACTION_CALL: ActionCall<void> = {
    actor: { kind: 'voice', id: 'voice-session' },
    context: undefined
};
