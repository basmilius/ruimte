export function terminalDictationText(text: string): string {
    // eslint-disable-next-line no-control-regex -- Terminal control bytes must never be pasted from a transcript.
    return text.replace(/[\r\n\t\u2028\u2029]/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}
