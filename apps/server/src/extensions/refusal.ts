import { CodedError } from '@adecore/agents';
import { extensionErrorCodeOf, isArgumentErrorCode, type ExtensionErrorCode } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';

/* `invalid-input` is the one code an extension hears as a throw: it gave an argument of the wrong shape. */
type ExtensionRefusalCode = ExtensionErrorCode | 'invalid-input';

export class ExtensionRefusal extends CodedError<ExtensionRefusalCode> {}

/* Any failure on its way to an extension, with the code it reads. A plain error is `failed` with its own message. */
export function extensionFailureOf(e: unknown): { code: ExtensionRefusalCode; message: string } {
    if (e instanceof CodedError) {
        return { code: isArgumentErrorCode(e.code) ? 'invalid-input' : extensionErrorCodeOf(e.code), message: e.message };
    }

    return { code: 'failed', message: errorText(e) };
}

export function asExtensionRefusal(e: unknown): ExtensionRefusal {
    if (e instanceof ExtensionRefusal) {
        return e;
    }

    const { code, message } = extensionFailureOf(e);

    return new ExtensionRefusal(code, message);
}
