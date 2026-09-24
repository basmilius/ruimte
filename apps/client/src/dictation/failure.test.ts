import { describe, expect, test } from 'bun:test';
import { DictationError } from './engine';
import { dictationFailureText } from './failure';

describe('what a failed dictation says', () => {
    test('a code of its own reads as a sentence', () => {
        expect(dictationFailureText(new DictationError('noBridge'))).toBe('Speech to Text needs the desktop app.');
        expect(dictationFailureText(new DictationError('targetChanged'))).toBe('The text field changed. Dictate again.');
    });

    test('a microphone that would not open says why, in the words the interface uses', () => {
        expect(dictationFailureText(new DOMException('Permission denied', 'NotAllowedError'))).toBe(
            'Microphone access was denied. Allow it in System Settings, then try again.'
        );
        expect(dictationFailureText(new DOMException('Requested device not found', 'NotFoundError'))).toBe('No microphone was found.');
    });

    test('anything else never shows its own message', () => {
        expect(dictationFailureText(new Error('AudioWorklet crashed'))).toBe('Dictation stopped unexpectedly. Try again.');
        expect(dictationFailureText('no-bridge')).toBe('Dictation stopped unexpectedly. Try again.');
    });
});
