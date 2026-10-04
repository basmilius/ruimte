import type { SignatureHelp, SignatureInformation } from '@ruimte/smart-editor-lsp';
import { documentationText } from './completion-model';

/* The signature help of a call, ready to draw: the label with the active parameter marked, and what is said about it. */
export interface SignatureViewModel {
    readonly label: string;
    /* The active parameter's characters in the label, or null when the server named none. */
    readonly active: { readonly start: number; readonly end: number } | null;
    readonly parameterName: string;
    readonly parameterDocumentation: string;
    readonly documentation: string;
    /* Zero-based, and how many overloads the server knows. */
    readonly index: number;
    readonly count: number;
}

/* Where a parameter's label stands in the signature's: given as a pair of offsets, or as the text to find in it. */
export function parameterSpan(signature: SignatureInformation, index: number): { start: number; end: number } | null {
    const parameter = signature.parameters?.[index];
    if (parameter === undefined) {
        return null;
    }
    if (typeof parameter.label !== 'string') {
        const [start, end] = parameter.label;
        return start >= 0 && end <= signature.label.length && start < end ? { start, end } : null;
    }
    const start = signature.label.indexOf(parameter.label);
    return start < 0 ? null : { start, end: start + parameter.label.length };
}

export function signatureViewOf(help: SignatureHelp | null): SignatureViewModel | null {
    if (help === null || help.signatures.length === 0) {
        return null;
    }
    const index = Math.min(Math.max(0, help.activeSignature ?? 0), help.signatures.length - 1);
    const signature = help.signatures[index]!;
    const parameterIndex = signature.activeParameter ?? help.activeParameter ?? 0;
    const active = parameterSpan(signature, parameterIndex);
    const parameter = signature.parameters?.[parameterIndex];
    return {
        label: signature.label,
        active,
        parameterName: active === null ? '' : signature.label.slice(active.start, active.end).replace(/[?:].*$/s, ''),
        parameterDocumentation: documentationText(parameter?.documentation),
        documentation: documentationText(signature.documentation),
        index,
        count: help.signatures.length
    };
}
