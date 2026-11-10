import { describe, expect, test } from 'bun:test';
import { UNCODED_FAILURE_CODE } from '@ruimte/actions';
import { confirmationRequestOutput, failedActionOutput, refusedOutput, toolErrorOutput } from './tool-output.ts';

describe('what the model hears of a failed action', () => {
    test('a refusal the registry coded is told as it is', () => {
        expect(failedActionOutput({ action: 'view.rename', error: { code: 'invalid-input', message: 'Name the view.' } })).toEqual(
            refusedOutput('invalid-input', 'Name the view.')
        );
    });

    test('an error nobody coded is never repeated, since its message may quote a path', () => {
        const output = failedActionOutput({ action: 'file.read', error: { code: UNCODED_FAILURE_CODE, message: 'ENOENT: /Users/secret/.env' } });

        expect(output).toEqual({ ok: false, code: 'tool-error', message: '“file.read” failed on this machine.' });
        expect(JSON.stringify(output)).not.toContain('secret');
    });

    test('an uncoded error with no action still says that something failed', () => {
        expect(toolErrorOutput(null)).toEqual({ ok: false, code: 'tool-error', message: '“The action” failed on this machine.' });
    });

    test('a question that waits for the person carries its token and its question', () => {
        const confirmation = { title: 'Delete the view?', consequences: ['The view is gone.'] };

        expect(confirmationRequestOutput({ confirmationToken: 'token-1', confirmation })).toEqual({
            ok: false,
            message: 'Ask the user to confirm or cancel this action before continuing.',
            needs_confirmation: true,
            confirmation_token: 'token-1',
            confirmation
        });
    });
});
