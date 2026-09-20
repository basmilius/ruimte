// A paste never includes terminal controls, even when the recognizer emits an unexpected character.
// eslint-disable-next-line no-control-regex -- Terminal control bytes must never be pasted from a transcript.
export const terminalDictationText = (text: string): string => text.replace(/[\r\n\t\u2028\u2029]/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
