import type { ActionRegistry, ActionResult } from '@ruimte/actions';
import { VOICE_ACTION_CALL } from '@/action-port/perform';

export function completed<Result extends ActionResult>(result: Result): Extract<Result, { status: 'completed' }> {
    if (result.status !== 'completed') {
        throw new Error(`Expected a completed action, got ${JSON.stringify(result)}`);
    }
    return result as Extract<Result, { status: 'completed' }>;
}

/* Answers yes to the question an action asked and hands back what it did. */
export async function confirmed(registry: ActionRegistry<void>, asked: ActionResult): Promise<ActionResult> {
    if (asked.status !== 'needs_confirmation') {
        throw new Error(`Expected a confirmation, got ${JSON.stringify(asked)}`);
    }
    return registry.confirm(asked.confirmationToken, true, VOICE_ACTION_CALL);
}

export function expectQuestion<Result extends ActionResult>(result: Result): asserts result is Extract<Result, { status: 'needs_confirmation' }> {
    if (result.status !== 'needs_confirmation') {
        throw new Error(`Expected a confirmation, got ${result.status}`);
    }
}

export function expectUndoable<Result extends ActionResult>(
    result: Result
): asserts result is Extract<Result, { status: 'completed' }> & { undoToken: string } {
    if (result.status !== 'completed' || !result.undoToken) {
        throw new Error('Expected a completed action with an undo token');
    }
}

/* The title and consequences of the question an action asked, as one string to look words up in. */
export function questionOf(result: ActionResult): string {
    expectQuestion(result);
    return [result.confirmation.title, ...result.confirmation.consequences].join(' ');
}
