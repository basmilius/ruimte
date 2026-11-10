import { UNCODED_FAILURE_CODE, type ActionFailed, type ActionNeedsConfirmation } from '@ruimte/actions';

/*
 * How a refused or failed action reaches the model, whoever runs the session. A refusal the registry
 * coded says what to do instead and is meant to be heard. Any other error carries the message of
 * whatever was thrown, which may quote a path or what it failed on, so the model hears only that it failed.
 */
export type VoiceToolOutput = Record<string, unknown>;

export function refusedOutput(code: string, message: string): VoiceToolOutput {
    return { ok: false, code, message };
}

/* An error nobody coded: the tool failed, and nothing else about it is said. */
export function toolErrorOutput(action: string | null): VoiceToolOutput {
    return refusedOutput('tool-error', `“${action ?? 'The action'}” failed on this machine.`);
}

export function confirmationRequestOutput(result: Pick<ActionNeedsConfirmation, 'confirmationToken' | 'confirmation'>): VoiceToolOutput {
    return {
        ok: false,
        message: 'Ask the user to confirm or cancel this action before continuing.',
        needs_confirmation: true,
        confirmation_token: result.confirmationToken,
        confirmation: result.confirmation
    };
}

export function failedActionOutput(result: Pick<ActionFailed, 'action' | 'error'>): VoiceToolOutput {
    if (result.error.code === UNCODED_FAILURE_CODE) {
        return toolErrorOutput(result.action);
    }
    return refusedOutput(result.error.code, result.error.message);
}
